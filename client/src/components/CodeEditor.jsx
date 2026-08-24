import { useRef, useCallback, useEffect } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { useCollaboration } from '../hooks/useCollaboration';
import { userColor } from '../lib/userColor';

const MONACO_LANG_MAP = {
  python: 'python',
  javascript: 'javascript',
  cpp: 'cpp',
  go: 'go',
};

// ─── Cursor presence utilities ────────────────────────────────────────────────

/**
 * Build the DOM node for a remote cursor widget.
 * Renders only a slim 2 px colored vertical bar at the user's cursor position.
 * The color matches the avatar color shown in the "In this room" sidebar.
 */
function buildCursorDomNode(color) {
  const container = document.createElement('div');
  container.style.cssText = 'position: relative; pointer-events: none; width: 2px;';

  const bar = document.createElement('div');
  bar.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: 2px;
    height: 20px;
    background: ${color};
    border-radius: 1px;
  `;

  container.appendChild(bar);
  return container;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CodeEditor({
  roomId,
  language,
  onExecResult,
  onExecRunning,
  onUsersChange,
  onConnectedChange,
  onLanguageChange,
  onSendExecRef,
  onAuthFailed,
}) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);

  // THIS is the gate that breaks the feedback loop.
  // Set to true before we apply a remote op via executeEdits,
  // cleared immediately after. handleChange checks this and skips
  // sending an op when it's true.
  const isApplyingRemote = useRef(false);

  // Buffers a sync payload that arrived before Monaco finished mounting.
  // Flushed inside handleEditorMount so content is never lost.
  const pendingSyncRef = useRef(null);

  // Refs so event-handler closures always see the latest sendCursor
  const sendCursorRef = useRef(null);
  const cursorThrottleRef = useRef(null);

  /**
   * Map of username → Monaco content widget.
   * Content widgets are real DOM nodes positioned at an exact editor position.
   * This approach works reliably across ALL Monaco versions (unlike `after` decorations).
   */
  const cursorWidgetsRef = useRef(new Map());

  /**
   * Apply a remote OT op to the Monaco editor.
   * Runs INSIDE CodeEditor so it can set isApplyingRemote synchronously
   * before executeEdits triggers onChange.
   */
  const applyRemoteOp = useCallback((op) => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    isApplyingRemote.current = true;
    try {
      if (op.type === 'insert') {
        const pos = model.getPositionAt(op.position);
        editor.executeEdits('remote-op', [{
          range: {
            startLineNumber: pos.lineNumber, startColumn: pos.column,
            endLineNumber: pos.lineNumber,   endColumn: pos.column,
          },
          text: op.text,
        }]);
      } else if (op.type === 'delete') {
        const start = model.getPositionAt(op.position);
        const end   = model.getPositionAt(op.position + op.length);
        editor.executeEdits('remote-op', [{
          range: {
            startLineNumber: start.lineNumber, startColumn: start.column,
            endLineNumber: end.lineNumber,     endColumn: end.column,
          },
          text: '',
        }]);
      }
    } finally {
      // Always clear the flag, even if executeEdits throws
      isApplyingRemote.current = false;
    }
  }, []);

  /**
   * Called when server sends a full sync (initial join or reconnect).
   * Also guarded so setValue doesn't echo back as a local op.
   *
   * Race condition guard: if Monaco hasn't mounted yet (editorRef is null),
   * buffer the content in pendingSyncRef and apply it in handleEditorMount.
   */
  const onSync = useCallback((content) => {
    const editor = editorRef.current;
    if (!editor) {
      // Monaco isn't ready yet — buffer and apply on mount
      pendingSyncRef.current = content;
      return;
    }
    isApplyingRemote.current = true;
    try {
      editor.setValue(content);
    } finally {
      isApplyingRemote.current = false;
    }
  }, []);

  const {
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
  } = useCollaboration(roomId, language, applyRemoteOp, onSync);

  // Keep sendCursorRef current so the Monaco event handler closure sees it
  useEffect(() => { sendCursorRef.current = sendCursor; }, [sendCursor]);

  // Propagate state up to EditorPage
  useEffect(() => { onExecResult?.(execResult); }, [execResult]);
  useEffect(() => { onExecRunning?.(execRunning); }, [execRunning]);
  useEffect(() => { onUsersChange?.(users); }, [users]);
  useEffect(() => { onConnectedChange?.(connected); }, [connected]);
  useEffect(() => { onLanguageChange?.(roomLanguage); }, [roomLanguage]);
  useEffect(() => { if (authFailed) onAuthFailed?.(); }, [authFailed]);

  /**
   * Broadcast a local language change to the room.
   *
   * Triggered when `language` prop changes (user clicked the dropdown).
   * Loop-safe: when a remote `language_change` arrives, roomLanguage and language
   * converge to the same value, so `language !== roomLanguage` is false → no echo.
   */
  useEffect(() => {
    if (language !== roomLanguage) {
      sendLanguageChange(language);
    }
  }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  // Give EditorPage a way to trigger execution imperatively
  useEffect(() => { if (onSendExecRef) onSendExecRef.current = sendExec; }, [sendExec]);

  /**
   * Sync remote cursor widgets with the current remoteCursors map.
   *
   * Uses Monaco's Content Widget API — real positioned DOM nodes — rather
   * than the unreliable `after` decoration injection. This is the same
   * mechanism used by VS Code Live Share.
   */
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;

    const activeUsernames = new Set(Object.keys(remoteCursors));

    // Remove widgets whose users have left
    for (const [username, widget] of cursorWidgetsRef.current) {
      if (!activeUsernames.has(username)) {
        editor.removeContentWidget(widget);
        cursorWidgetsRef.current.delete(username);
      }
    }

    // Add or move widgets for every known remote cursor
    for (const [username, position] of Object.entries(remoteCursors)) {
      const color = userColor(username);
      const safePos = Math.max(0, Math.min(position, model.getValueLength()));
      const monacoPos = model.getPositionAt(safePos);

      if (cursorWidgetsRef.current.has(username)) {
        // Widget already exists — just update its position and re-layout
        const widget = cursorWidgetsRef.current.get(username);
        widget._position = monacoPos;
        editor.layoutContentWidget(widget);
      } else {
        // First time seeing this user — create a new content widget
        const domNode = buildCursorDomNode(color);

        const widget = {
          _position: monacoPos,
          getId()    { return `remote-cursor-${username}`; },
          getDomNode() { return domNode; },
          getPosition() {
            return {
              position: this._position,
              // EXACT places the widget's top-left at the character position
              preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
            };
          },
        };

        cursorWidgetsRef.current.set(username, widget);
        editor.addContentWidget(widget);
      }
    }
  }, [remoteCursors]);

  // Cleanup all content widgets when the component unmounts
  useEffect(() => {
    return () => {
      const editor = editorRef.current;
      if (!editor) return;
      for (const widget of cursorWidgetsRef.current.values()) {
        try { editor.removeContentWidget(widget); } catch (_) { /* ignore */ }
      }
      cursorWidgetsRef.current.clear();
    };
  }, []);

  const handleEditorMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Flush any sync content that arrived before Monaco was ready
    if (pendingSyncRef.current !== null) {
      isApplyingRemote.current = true;
      try {
        editor.setValue(pendingSyncRef.current);
      } finally {
        isApplyingRemote.current = false;
        pendingSyncRef.current = null;
      }
    }

    /**
     * Broadcast this user's cursor position to the room on every cursor move.
     * Throttled to max one message per 80 ms to avoid flooding the server.
     * Skipped when isApplyingRemote so we don't spam during remote op application.
     */
    editor.onDidChangeCursorPosition((e) => {
      if (isApplyingRemote.current) return;
      if (cursorThrottleRef.current) return; // already scheduled

      cursorThrottleRef.current = setTimeout(() => {
        cursorThrottleRef.current = null;
        const model = editor.getModel();
        if (!model) return;
        const offset = model.getOffsetAt(e.position);
        sendCursorRef.current?.(offset);
      }, 80);
    });
  }, []);

  /**
   * Convert Monaco's content-change event into OT operations.
   * CRITICAL: bail out immediately if isApplyingRemote is set —
   * that means this change was triggered by us applying a remote op,
   * not by the user typing.
   */
  const handleChange = useCallback((_value, event) => {
    // ← skip changes we caused ourselves
    if (isApplyingRemote.current) return;

    for (const change of event.changes) {
      const { rangeOffset, rangeLength, text } = change;

      if (rangeLength > 0 && text.length > 0) {
        // Replace = delete then insert
        sendLocalOp({ type: 'delete', position: rangeOffset, length: rangeLength });
        sendLocalOp({ type: 'insert', position: rangeOffset, text });
      } else if (rangeLength > 0) {
        sendLocalOp({ type: 'delete', position: rangeOffset, length: rangeLength });
      } else if (text.length > 0) {
        sendLocalOp({ type: 'insert', position: rangeOffset, text });
      }
    }
  }, [sendLocalOp]);

  return (
    <div className="editor-wrapper">
      <MonacoEditor
        height="100%"
        language={MONACO_LANG_MAP[roomLanguage] || 'plaintext'}
        theme="vs-dark"
        onMount={handleEditorMount}
        onChange={handleChange}
        options={{
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          lineNumbers: 'on',
          renderWhitespace: 'selection',
          tabSize: 4,
          automaticLayout: true,
          cursorBlinking: 'smooth',
          wordWrap: 'on',
        }}
      />
    </div>
  );
}
