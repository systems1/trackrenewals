import { useAuth } from '../context/AuthContext.jsx';
import { BrandMark } from './Navbar.jsx';

const VALUE_PROPS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
    ),
    title: 'Auto-discover every certificate',
    text: 'CT-log powered discovery finds certs on hosts you didn’t even know existed.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8v4l2.5 2.5" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
    title: 'Alerts before it breaks',
    text: '60/30/14/7/1-day warnings — including “issued but never deployed” renewals.',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
    title: 'Zero installs on client infra',
    text: 'Agentless by design — no agents, no private keys, no DNS credentials.',
  },
];

export default function LoginPage() {
  const { login } = useAuth();

  return (
    <div className="login-shell">
      <aside className="login-brand-panel">
        <div className="login-brand-story">
          <div className="login-brand-mark">
            <BrandMark size={26} /> TrackCertRenewals
          </div>
          <h1>
            Every certificate your clients depend on, <em>in one place</em>.
          </h1>
          <p>
            Discovered automatically. Owned by whoever renews it. Alerted before it
            breaks. Built for MSPs and agencies — not SREs.
          </p>
          <div className="value-props">
            {VALUE_PROPS.map((vp) => (
              <div className="value-prop" key={vp.title}>
                <span className="vp-icon">{vp.icon}</span>
                <div>
                  <strong>{vp.title}</strong>
                  <span>{vp.text}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <main className="login-form-panel">
        <div className="login-card">
          <div className="app-mark">
            <BrandMark size={30} />
          </div>
          <h1 className="app-title">TrackCertRenewals</h1>
          <p className="app-subtitle">Certificate intelligence for managed service providers</p>
          <button className="btn google-btn" onClick={login}>
            <img
              src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
              alt="Google logo"
              className="google-logo"
            />
            Sign in with Google
          </button>
          <p className="login-hint">Free up to 10 domains · No agents · No credit card</p>
        </div>
      </main>
    </div>
  );
}
