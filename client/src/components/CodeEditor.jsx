import { useRef, useCallback, useEffect } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { useCollaboration } from '../hooks/useCollaboration';
import { suppressRemoteRef_global, clearSuppressFlag } from '../hooks/useCollaboration';

const MONACO_LANG_MAP = {
  python: 'python',
  javascript: 'javascript',
  cpp: 'cpp',
  go: 'go',
};

export default function CodeEditor({ roomId, language, onExecResult, onExecRunning, onUsersChange, onConnectedChange, onLanguageChange }) {
  const editorRef = useRef(null);
  const lastContentRef = useRef('');
  const isApplyingRemote = useRef(false);

  const {
    connected,
    users,
    execResult,
    execRunning,
    roomLanguage,
    sendLocalOp,
    sendExec,
    sendLanguageChange,
  } = useCollaboration(roomId, language, editorRef);

  // Propagate state to parent
  useEffect(() => { onExecResult?.(execResult); }, [execResult]);
  useEffect(() => { onExecRunning?.(execRunning); }, [execRunning]);
  useEffect(() => { onUsersChange?.(users); }, [users]);
  useEffect(() => { onConnectedChange?.(connected); }, [connected]);
  useEffect(() => { onLanguageChange?.(roomLanguage); }, [roomLanguage]);

  const handleEditorMount = useCallback((editor) => {
    editorRef.current = editor;
    lastContentRef.current = editor.getValue();
  }, []);

  /**
   * Convert Monaco's content-change event into OT operations.
   * Monaco gives us an array of changes, each with a range and new text.
   * We convert each to an insert or delete op based on what changed.
   */
  const handleChange = useCallback((value, event) => {
    if (isApplyingRemote.current) return;

    const model = editorRef.current?.getModel();
    if (!model) return;

    for (const change of event.changes) {
      const { range, text, rangeOffset, rangeLength } = change;

      if (rangeLength > 0 && text.length > 0) {
        // Replace = delete + insert. Send delete first.
        sendLocalOp({ type: 'delete', position: rangeOffset, length: rangeLength });
        sendLocalOp({ type: 'insert', position: rangeOffset, text });
      } else if (rangeLength > 0) {
        // Pure delete
        sendLocalOp({ type: 'delete', position: rangeOffset, length: rangeLength });
      } else if (text.length > 0) {
        // Pure insert
        sendLocalOp({ type: 'insert', position: rangeOffset, text });
      }
    }

    lastContentRef.current = value;
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
