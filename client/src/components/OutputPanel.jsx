export default function OutputPanel({ result, running }) {
  if (running) {
    return (
      <div className="output-panel">
        <div className="output-header">Output</div>
        <div className="output-body output-running">
          <span className="spinner" /> Executing...
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="output-panel">
        <div className="output-header">Output</div>
        <div className="output-body output-empty">
          Press <kbd>Run</kbd> to execute the code across the cluster.
        </div>
      </div>
    );
  }

  const hasError = result.exitCode !== 0 || result.stderr;

  return (
    <div className="output-panel">
      <div className="output-header">
        <span>Output</span>
        <span className={`exit-badge ${hasError ? 'exit-error' : 'exit-ok'}`}>
          Exit {result.exitCode} · {result.executionTime}ms
        </span>
      </div>
      <div className="output-body">
        {result.stdout && (
          <pre className="output-stdout">{result.stdout}</pre>
        )}
        {result.stderr && (
          <pre className="output-stderr">{result.stderr}</pre>
        )}
        {!result.stdout && !result.stderr && (
          <div className="output-empty">No output.</div>
        )}
      </div>
    </div>
  );
}
