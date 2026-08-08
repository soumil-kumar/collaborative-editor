import { useState, useRef } from 'react';
import CodeEditor from './CodeEditor';
import OutputPanel from './OutputPanel';
import UserPresence from './UserPresence';
import Toolbar from './Toolbar';

export default function EditorPage({ roomId, username, onLogout }) {
  const [language, setLanguage] = useState('python');
  const [execResult, setExecResult] = useState(null);
  const [execRunning, setExecRunning] = useState(false);
  const [users, setUsers] = useState([]);
  const [connected, setConnected] = useState(false);

  // CodeEditor writes its sendExec function into this ref when mounted
  const sendExecRef = useRef(null);
  const handleRun = () => sendExecRef.current?.();

  return (
    <div className="editor-page">
      <Toolbar
        language={language}
        onLanguageChange={setLanguage}
        onRun={handleRun}
        execRunning={execRunning}
        connected={connected}
      />
      <div className="editor-main">
        <div className="editor-area">
          <CodeEditor
            roomId={roomId}
            language={language}
            onExecResult={setExecResult}
            onExecRunning={setExecRunning}
            onUsersChange={setUsers}
            onConnectedChange={setConnected}
            onLanguageChange={setLanguage}
            onSendExecRef={sendExecRef}
          />
          <OutputPanel result={execResult} running={execRunning} />
        </div>
        <aside className="sidebar">
          <div className="room-info">
            <div className="room-label">Room ID</div>
            <div className="room-id">{roomId}</div>
            <button
              className="btn-copy"
              onClick={() => navigator.clipboard.writeText(roomId)}
            >Copy</button>
          </div>
          <UserPresence users={users} currentUser={username} />
          <button className="btn-logout" onClick={onLogout}>Sign Out</button>
        </aside>
      </div>
    </div>
  );
}
