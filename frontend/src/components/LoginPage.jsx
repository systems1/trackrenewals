import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const { login } = useAuth();

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="app-title">TrackAssets</h1>
        <p className="app-subtitle">Manage your domain notes in one place</p>
        <button className="btn btn-primary google-btn" onClick={login}>
          <img
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            alt="Google logo"
            className="google-logo"
          />
          Sign in with Google
        </button>
      </div>
    </div>
  );
}