import { useEffect, useRef, useState, useCallback } from 'react';
import { OTClient } from '../lib/ot';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4000/ws';
const RECONNECT_DELAY_MS = [1000, 2000, 4000, 8000]; // Exponential backoff

/**
 * @param roomId       - Room to join
 * @param language     - Initial language
 * @param applyRemoteOp - Callback from CodeEditor to apply a remote op.
 *                        CodeEditor owns this function and sets its own
 *                        isApplyingRemote guard inside it, preventing echo.
 * @param onSync       - Called with full document content on initial join
 */
export function useCollaboration(roomId, language, applyRemoteOp, onSync) {
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState([]);
  const [execResult, setExecResult] = useState(null);
  const [execRunning, setExecRunning] = useState(false);
  const [serverVersion, setServerVersion] = useState(0);
  const [roomLanguage, setRoomLanguage] = useState(language);

  const wsRef = useRef(null);
  const otClientRef = useRef(null);
  const reconnectAttempts = useRef(0);
  // Keep latest callbacks in refs so the WS handler always sees current versions
  const applyRemoteOpRef = useRef(applyRemoteOp);
  const onSyncRef = useRef(onSync);
  useEffect(() => { applyRemoteOpRef.current = applyRemoteOp; }, [applyRemoteOp]);
  useEffect(() => { onSyncRef.current = onSync; }, [onSync]);

  const getToken = () => localStorage.getItem('token');

  const connect = useCallback(() => {
    const token = getToken();
    if (!token || !roomId) return;

    const url = `${WS_URL}?token=${encodeURIComponent(token)}&roomId=${encodeURIComponent(roomId)}&language=${language}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    const sendOp = (op, baseVersion) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'op', op, baseVersion }));
      }
    };

    otClientRef.current = new OTClient(sendOp);

    ws.onopen = () => {
      setConnected(true);
      reconnectAttempts.current = 0;
    };

    ws.onclose = (event) => {
      setConnected(false);
      if (event.code === 4001) return; // Auth failure — don't reconnect
      // Exponential backoff reconnect
      const delay = RECONNECT_DELAY_MS[Math.min(reconnectAttempts.current, RECONNECT_DELAY_MS.length - 1)];
      reconnectAttempts.current++;
      setTimeout(connect, delay);
    };

    ws.onerror = () => setConnected(false);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'sync': {
          // Full document sync on join — tell CodeEditor to reset its content
          setServerVersion(msg.version);
          setUsers(msg.users || []);
          setRoomLanguage(msg.language);
          onSyncRef.current?.(msg.content);
          break;
        }

        case 'op': {
          // Remote op from another user — transform, then hand to CodeEditor to apply
          const transformedOp = otClientRef.current.remoteOp(msg.op);
          setServerVersion(msg.version);
          if (transformedOp) {
            applyRemoteOpRef.current?.(transformedOp);
          }
          break;
        }

        case 'ack': {
          // Our op was accepted — advance version
          setServerVersion(msg.version);
          otClientRef.current.serverAck(msg.version);
          break;
        }

        case 'user_joined':
        case 'user_left':
          setUsers(msg.users || []);
          break;

        case 'language_change':
          setRoomLanguage(msg.language);
          break;

        case 'exec_start':
          setExecRunning(true);
          setExecResult(null);
          break;

        case 'exec_result':
          setExecRunning(false);
          setExecResult(msg);
          break;

        default:
          break;
      }
    };
  }, [roomId, language]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const sendLocalOp = useCallback((op) => {
    otClientRef.current?.localOp(op, serverVersion);
  }, [serverVersion]);

  const sendExec = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'exec', language: roomLanguage }));
    }
  }, [roomLanguage]);

  const sendLanguageChange = useCallback((lang) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'language_change', language: lang }));
    }
  }, []);

  return {
    connected,
    users,
    execResult,
    execRunning,
    roomLanguage,
    sendLocalOp,
    sendExec,
    sendLanguageChange,
  };
}
