import { deleteDomain, refreshSSL } from '../api.js';

export default function DomainList({ domains, onEdit, onRefresh }) {
  async function handleDelete(id, domainName) {
    const confirmed = window.confirm(`Delete domain "${domainName}"?`);
    if (!confirmed) return;

    try {
      await deleteDomain(id);
      await onRefresh();
    } catch (err) {
      alert('Failed to delete domain.');
    }
  }

  async function handleRefreshSSL(id) {
    try {
      await refreshSSL(id);
    } catch (err) {
      console.error('Failed to refresh SSL:', err);
    } finally {
      await onRefresh();
    }
  }

  function formatSSLDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  if (domains.length === 0) {
    return (
      <div className="empty-state">
        <p>No domains yet. Click "Add Domain" to get started.</p>
      </div>
    );
  }

  return (
    <div className="domain-list">
      {domains.map((domain) => (
        <div key={domain.id} className="domain-card">
          <div className="domain-card-body">
            <div className="domain-name">{domain.domain_name}</div>
            <div className="domain-notes">{domain.notes || '—'}</div>
            {domain.ssl_renewal ? (
              <div className="domain-ssl">SSL expires: {formatSSLDate(domain.ssl_renewal)}</div>
            ) : (
              <div className="domain-ssl domain-ssl-none">No SSL certificate</div>
            )}
          </div>
          <div className="domain-card-actions">
            <button className="btn btn-secondary btn-small" onClick={() => onEdit(domain)}>
              Edit
            </button>
            <button
              className="btn btn-secondary btn-small"
              onClick={() => handleRefreshSSL(domain.id)}
            >
              Refresh SSL
            </button>
            <button
              className="btn btn-danger btn-small"
              onClick={() => handleDelete(domain.id, domain.domain_name)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}