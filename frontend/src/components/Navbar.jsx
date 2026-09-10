import { useAuth } from '../context/AuthContext.jsx';

export function BrandMark({ size = 17 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export default function Navbar() {
  const { user, logout } = useAuth();

  const initials = (user?.name || user?.email || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <span className="brand-mark">
          <BrandMark />
        </span>
        <span className="wordmark">
          Track<span>Assets</span>
        </span>
      </div>
      {user && (
        <div className="navbar-user">
          <div className="user-chip">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt={user.name} className="user-avatar" />
            ) : (
              <span className="avatar-fallback">{initials}</span>
            )}
            <span className="user-name">{user.name || user.email}</span>
          </div>
          <button className="btn btn-ghost btn-small" onClick={logout}>
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}
