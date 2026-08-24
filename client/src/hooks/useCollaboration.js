import { useEffect, useRef, useState, useCallback } from 'react';
import { OTClient } from '../lib/ot';

const getDefaultWsUrl = () => {
  if (typeof window === 'undefined') return 'ws://localhost:4000/ws';
  if (window.location.port === '5173') return 'ws://localhost:4000/ws';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
};

const WS_URL = import.meta.env.VITE_WS_URL || getDefaultWsUrl();
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
  const [authFailed, setAuthFailed] = useState(false);
  const [users, setUsers] = useState([]);
  const [execResult, setExecResult] = useState(null);
  const [execRunning, setExecRunning] = useState(false);
  const [serverVersion, setServerVersion] = useState(0);
  const [roomLanguage, setRoomLanguage] = useState(language);
  // remoteCursors: { [username]: characterOffset } — positions of every other user's cursor
  const [remoteCursors, setRemoteCursors] = useState({});

  const wsRef = useRef(null);
  const otClientRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const intentionalClose = useRef(false); // Prevents reconnect on cleanup unmount
  // Keep latest callbacks in refs so the WS handler always sees current versions
  const applyRemoteOpRef = useRef(applyRemoteOp);
  const onSyncRef = useRef(onSync);
  // Holds the language to include in the initial WS URL.
  // Stored in a ref so that language changes don't recreate `connect`,
  // which would trigger a full WebSocket reconnect + sync flash (the "jitter").
  // After the initial join, language changes travel as `language_change` messages
  // over the existing socket instead.
  const joinLanguageRef = useRef(language);
  useEffect(() => { applyRemoteOpRef.current = applyRemoteOp; }, [applyRemoteOp]);
  useEffect(() => { onSyncRef.current = onSync; }, [onSync]);

  const getToken = () => localStorage.getItem('token');

  const connect = useCallback(() => {
    const token = getToken();
    if (!token || !roomId) {
      setAuthFailed(true);
      return;
    }

    // Close any existing connection before opening a new one
    if (wsRef.current) {
      intentionalClose.current = true;
      wsRef.current.close();
      intentionalClose.current = false;
    }

    const url = `${WS_URL}?token=${encodeURIComponent(token)}&roomId=${encodeURIComponent(roomId)}&language=${joinLanguageRef.current}`;
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
      // Don't reconnect if WE closed it (unmount/cleanup/intentional)
      if (intentionalClose.current) return;
      if (event.code === 4001) {
        // Token invalid/expired — signal auth failure so UI can redirect to login
        console.warn('[ws] Auth failed (4001). Token may be expired. Please log in again.');
        setAuthFailed(true);
        return;
      }
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
          setUsers(msg.users || []);
          break;

        case 'user_left':
          setUsers(msg.users || []);
          // Remove the departing user's cursor decoration
          setRemoteCursors(prev => {
            const next = { ...prev };
            delete next[msg.username];
            return next;
          });
          break;

        case 'cursor': {
          // Another user moved their cursor — store their character offset
          setRemoteCursors(prev => ({ ...prev, [msg.username]: msg.position }));
          break;
        }

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
  }, [roomId]); // language intentionally omitted — changes go via language_change messages, not reconnects

  useEffect(() => {
    intentionalClose.current = false;
    connect();
    return () => {
      intentionalClose.current = true;
      wsRef.current?.close();
    };
  }, [connect]);

  const sendLocalOp = useCallback((op) => {
    otClientRef.current?.localOp(op, serverVersion);
  }, [serverVersion]);

  const sendExec = useCallback((stdin = '') => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'exec', language: roomLanguage, stdin }));
    }
  }, [roomLanguage]);

  const sendLanguageChange = useCallback((lang) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'language_change', language: lang }));
    }
  }, []);

  const sendCursor = useCallback((position) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cursor', position }));
    }
  }, []);

  return {
    connected,
    authFailed,
    users,
    execResult,
    execRunning,
    roomLanguage,
    remoteCursors,
    sendLocalOp,
    sendExec,
    sendLanguageChange,
    sendCursor,
  };
}
