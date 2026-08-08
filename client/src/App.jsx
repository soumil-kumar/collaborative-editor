import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import AuthPage from './components/AuthPage';
import EditorPage from './components/EditorPage';
import './App.css';

export default function App() {
  const [username, setUsername] = useState(() => localStorage.getItem('username') || null);
  const [roomId, setRoomId] = useState(null);
  const [joinInput, setJoinInput] = useState('');

  const handleAuth = (name) => setUsername(name);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    setUsername(null);
    setRoomId(null);
  };

  // Not logged in → show auth page
  if (!username) {
    return <AuthPage onAuth={handleAuth} />;
  }

  // Logged in but no room yet → show lobby
  if (!roomId) {
    return (
      <div className="lobby-page">
        <div className="lobby-card">
          <div className="lobby-header">
            <span className="auth-logo-icon">{'</>'}</span>
            <h1>CodeCollab</h1>
            <p>Welcome, <strong>{username}</strong></p>
          </div>
          <div className="lobby-actions">
            <button className="btn-primary" onClick={() => setRoomId(uuidv4())}>
              + Create New Room
            </button>
            <div className="lobby-divider">or join existing</div>
            <div className="join-row">
              <input
                type="text"
                className="join-input"
                placeholder="Paste Room ID..."
                value={joinInput}
                onChange={e => setJoinInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && joinInput.trim() && setRoomId(joinInput.trim())}
              />
              <button
                className="btn-join"
                disabled={!joinInput.trim()}
                onClick={() => setRoomId(joinInput.trim())}
              >Join</button>
            </div>
          </div>
          <button className="btn-text" onClick={handleLogout}>Sign out</button>
        </div>
      </div>
    );
  }

  // In a room → show editor
  return <EditorPage roomId={roomId} username={username} onLogout={handleLogout} />;
}
