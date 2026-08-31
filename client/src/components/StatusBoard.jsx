import { formatRelative } from '../utils/time.js';

export default function StatusBoard({ users }) {
  if (!users.length) return <p className="muted">No team members yet.</p>;

  return (
    <ul className="board">
      {users.map((u) => (
        <li key={u._id} className={`board-row board-row-${u.status}`}>
          <span className="avatar" aria-hidden="true">
            {u.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
          </span>
          <div className="board-main">
            <div className="board-name">
              {u.name}
              {u.role === 'admin' && <span className="tag">admin</span>}
            </div>
            <div className="muted small">
              {u.department}
              {u.statusNote ? ` — ${u.statusNote}` : ''}
            </div>
          </div>
          <div className="board-right">
            <span className={`pill pill-${u.status}`}>{u.status === 'in' ? 'IN' : 'OUT'}</span>
            <div className="muted small">{u.lastSeenAt ? formatRelative(u.lastSeenAt) : 'never'}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
