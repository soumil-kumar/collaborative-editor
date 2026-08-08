const LANGUAGES = [
  { value: 'python', label: 'Python 3' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'cpp', label: 'C++' },
  { value: 'go', label: 'Go' },
];

export default function Toolbar({ language, onLanguageChange, onRun, execRunning, connected }) {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <span className="toolbar-brand">{'</>'} CodeCollab</span>
        <div className={`connection-badge ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? 'Live' : 'Reconnecting...'}
        </div>
      </div>
      <div className="toolbar-center">
        <select
          className="lang-select"
          value={language}
          onChange={e => onLanguageChange(e.target.value)}
        >
          {LANGUAGES.map(l => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>
      <div className="toolbar-right">
        <button
          className={`btn-run ${execRunning ? 'running' : ''}`}
          onClick={onRun}
          disabled={execRunning || !connected}
        >
          {execRunning ? (
            <><span className="spinner" /> Running...</>
          ) : (
            <> ▶ Run</>
          )}
        </button>
      </div>
    </div>
  );
}
