import { useRef, useCallback, useEffect } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { useCollaboration } from '../hooks/useCollaboration';

const MONACO_LANG_MAP = {
  python: 'python',
  javascript: 'javascript',
  cpp: 'cpp',
  go: 'go',
};

export default function CodeEditor({
  roomId,
  language,
  onExecResult,
  onExecRunning,
  onUsersChange,
  onConnectedChange,
  onLanguageChange,
  onSendExecRef,
}) {
  const editorRef = useRef(null);
  // THIS is the gate that breaks the feedback loop.
  // Set to true before we apply a remote op via executeEdits,
  // cleared immediately after. handleChange checks this and skips
  // sending an op when it's true.
  const isApplyingRemote = useRef(false);

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
   */
  const onSync = useCallback((content) => {
    const editor = editorRef.current;
    if (!editor) return;
    isApplyingRemote.current = true;
    try {
      editor.setValue(content);
    } finally {
      isApplyingRemote.current = false;
    }
  }, []);

  const {
    connected,
    users,
    execResult,
    execRunning,
    roomLanguage,
    sendLocalOp,
    sendExec,
    sendLanguageChange,
  } = useCollaboration(roomId, language, applyRemoteOp, onSync);

  // Propagate state up to EditorPage
  useEffect(() => { onExecResult?.(execResult); }, [execResult]);
  useEffect(() => { onExecRunning?.(execRunning); }, [execRunning]);
  useEffect(() => { onUsersChange?.(users); }, [users]);
  useEffect(() => { onConnectedChange?.(connected); }, [connected]);
  useEffect(() => { onLanguageChange?.(roomLanguage); }, [roomLanguage]);
  // Give EditorPage a way to trigger execution imperatively
  useEffect(() => { if (onSendExecRef) onSendExecRef.current = sendExec; }, [sendExec]);

  const handleEditorMount = useCallback((editor) => {
    editorRef.current = editor;
  }, []);

  /**
   * Convert Monaco's content-change event into OT operations.
   * CRITICAL: bail out immediately if isApplyingRemote is set —
   * that means this change was triggered by us applying a remote op,
   * not by the user typing.
   */
  const handleChange = useCallback((_value, event) => {
    // ← THE FIX: skip changes we caused ourselves
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
