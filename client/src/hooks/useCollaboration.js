import { useEffect, useRef, useState, useCallback } from 'react';
import { OTClient } from '../lib/ot';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4000/ws';
const RECONNECT_DELAY_MS = [1000, 2000, 4000, 8000]; // Exponential backoff

export function useCollaboration(roomId, language, editorRef) {
  const [connected, setConnected] = useState(false);
  const [users, setUsers] = useState([]);
  const [execResult, setExecResult] = useState(null);
  const [execRunning, setExecRunning] = useState(false);
  const [serverVersion, setServerVersion] = useState(0);
  const [roomLanguage, setRoomLanguage] = useState(language);

  const wsRef = useRef(null);
  const otClientRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const suppressRemoteRef = useRef(false); // Prevent re-sending applied remote ops

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
      const editor = editorRef?.current;

      switch (msg.type) {
        case 'sync': {
          // Full document sync on join
          setServerVersion(msg.version);
          setUsers(msg.users || []);
          setRoomLanguage(msg.language);
          if (editor) {
            suppressRemoteRef.current = true;
            editor.setValue(msg.content);
            suppressRemoteRef.current = false;
          }
          break;
        }

        case 'op': {
          // Remote op from another user — transform and apply
          const transformedOp = otClientRef.current.remoteOp(msg.op);
          setServerVersion(msg.version);
          if (editor && transformedOp) {
            applyOpToEditor(editor, transformedOp);
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
  }, [roomId, language, editorRef]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const sendLocalOp = useCallback((op) => {
    if (suppressRemoteRef.current) return;
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

/**
 * Apply an OT op directly to the Monaco editor model without triggering
 * the onChange listener (suppressRemoteRef handles this upstream).
 */
function applyOpToEditor(editor, op) {
  const model = editor.getModel();
  if (!model) return;

  suppressRemoteRef_global = true; // Signal to CodeEditor to skip sending this change

  if (op.type === 'insert') {
    const pos = model.getPositionAt(op.position);
    editor.executeEdits('remote', [{
      range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column },
      text: op.text,
    }]);
  } else if (op.type === 'delete') {
    const startPos = model.getPositionAt(op.position);
    const endPos = model.getPositionAt(op.position + op.length);
    editor.executeEdits('remote', [{
      range: { startLineNumber: startPos.lineNumber, startColumn: startPos.column, endLineNumber: endPos.lineNumber, endColumn: endPos.column },
      text: '',
    }]);
  }
}

// Module-level flag to suppress echo of remote edits back to the server
export let suppressRemoteRef_global = false;
export function clearSuppressFlag() { suppressRemoteRef_global = false; }
