import { userColor } from '../lib/userColor';

export default function UserPresence({ users, currentUser }) {
  return (
    <div className="user-presence">
      <h3 className="presence-title">In this room</h3>
      <ul className="user-list">
        {users.map((u) => (
          <li key={u} className="user-item">
            <span className="user-avatar" style={{ background: userColor(u) }}>
              {u[0].toUpperCase()}
            </span>
            <span className="user-name">
              {u} {u === currentUser ? <span className="you-badge">you</span> : null}
            </span>
            <span className="online-dot" />
          </li>
        ))}
      </ul>
    </div>
  );
}
