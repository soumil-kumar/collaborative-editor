import { useState, useRef, useEffect } from 'react';

const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 230;
const MAX_HEIGHT_RATIO = 0.72; // max 72% of viewport height

/**
 * TerminalPanel — resizable output + stdin panel.
 *
 * Layout (flex column, top → bottom):
 *   [drag-handle]   ← 6px grip bar, drag UP to grow, DOWN to shrink
 *   [tab-bar]       ← Output | Stdin, each takes 50% of width
 *   [body]          ← scrollable output or stdin textarea
 *
 * Key design notes:
 * - The drag handle is in NORMAL FLOW (not position:absolute) so it is
 *   never covered by the tab bar or any other sibling.
 * - Height is stored in a ref (heightRef) so the mousemove handler never
 *   needs to be re-registered — it always reads the current value via the ref.
 * - min-height:0 on .terminal-body (in CSS) enables overflow-y scrolling
 *   inside a flex column, which would otherwise be silently clipped.
 */
export default function TerminalPanel({ result, running, stdin, onStdinChange }) {
  const [activeTab, setActiveTab] = useState('output');
  const [height, setHeight] = useState(DEFAULT_HEIGHT);

  // Ref mirrors the state value so mouse handlers (registered once) always
  // read the current height without needing to be re-created on every change.
  const heightRef = useRef(DEFAULT_HEIGHT);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Auto-switch to Output tab whenever a run starts or result arrives.
  useEffect(() => {
    if (running || result) setActiveTab('output');
  }, [running, result]);

  // Register global mousemove / mouseup once (empty dep array).
  // All state reads go through refs, so this never needs re-registering.
  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const delta = startY.current - e.clientY; // drag up → taller
      const maxH = window.innerHeight * MAX_HEIGHT_RATIO;
      const next = Math.max(MIN_HEIGHT, Math.min(maxH, startHeight.current + delta));
      heightRef.current = next;
      setHeight(next);
    };

    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []); // empty — uses refs only

  const onDragHandleMouseDown = (e) => {
    e.preventDefault();
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = heightRef.current; // read from ref, always current
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  };

  const isError = result && (result.exitCode !== 0 || result.stderr);
  const stdinLineCount = stdin ? stdin.split('\n').filter((l) => l.trim()).length : 0;

  return (
    <div className="terminal-panel" style={{ height: `${height}px` }}>

      {/* ── Drag-to-resize handle (in normal flow, above tabs) ── */}
      <div
        className="terminal-drag-handle"
        onMouseDown={onDragHandleMouseDown}
        title="Drag to resize panel"
      >
        <div className="terminal-drag-grip" />
      </div>

      {/* ── Tab bar — full width, 50 / 50 split ── */}
      <div className="terminal-tabs">
        <button
          id="tab-btn-output"
          className={`terminal-tab${activeTab === 'output' ? ' active' : ''}`}
          onClick={() => setActiveTab('output')}
        >
          <span className="tab-label">▶ Output</span>
          {running && <span className="spinner" style={{ borderTopColor: 'var(--accent)' }} />}
          {!running && result && (
            <span className={`tab-badge ${isError ? 'tab-badge-error' : 'tab-badge-ok'}`}>
              Exit {result.exitCode} · {result.executionTime}ms
            </span>
          )}
        </button>

        <button
          id="tab-btn-stdin"
          className={`terminal-tab${activeTab === 'stdin' ? ' active' : ''}`}
          onClick={() => setActiveTab('stdin')}
        >
          <span className="tab-label">⌨ Stdin</span>
          {stdinLineCount > 0 && (
            <span className="tab-badge tab-badge-info">
              {stdinLineCount} {stdinLineCount === 1 ? 'line' : 'lines'}
            </span>
          )}
        </button>
      </div>

      {/* ── Body (scrollable) ── */}
      <div className="terminal-body">

        {/* Output tab */}
        {activeTab === 'output' && (
          <>
            {running && (
              <div className="terminal-running">
                <span className="spinner" /> Executing program…
              </div>
            )}
            {!running && !result && (
              <div className="terminal-empty">
                Press <kbd>Run</kbd> to execute · Switch to the <strong>Stdin</strong> tab to provide input
              </div>
            )}
            {!running && result && (
              <>
                {result.stdout && (
                  <pre className="output-stdout">{result.stdout}</pre>
                )}
                {result.stderr && (
                  <pre className="output-stderr">{result.stderr}</pre>
                )}
                {!result.stdout && !result.stderr && (
                  <div className="terminal-empty">Program exited with no output.</div>
                )}
              </>
            )}
          </>
        )}

        {/* Stdin tab */}
        {activeTab === 'stdin' && (
          <div className="stdin-wrapper">
            <textarea
              id="stdin-input"
              className="stdin-textarea"
              value={stdin}
              onChange={(e) => onStdinChange(e.target.value)}
              placeholder={
                'Type or paste your program\'s input here.\n' +
                'This is piped to stdin when you click Run.\n\n' +
                'Python  →  each input() call reads one line\n' +
                'C++     →  each cin >> reads one whitespace-separated token\n' +
                'Go      →  each fmt.Scan reads one token'
              }
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
            />
          </div>
        )}

      </div>
    </div>
  );
}
