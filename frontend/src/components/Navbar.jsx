import { useAuth } from '../context/AuthContext.jsx';

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <nav className="navbar">
      <span className="navbar-brand">TrackAssets</span>
      {user && (
        <div className="navbar-user">
          {user.avatar_url && (
            <img src={user.avatar_url} alt={user.name} className="user-avatar" />
          )}
          <span className="user-name">{user.name || user.email}</span>
          <button className="btn btn-secondary btn-small" onClick={logout}>
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}