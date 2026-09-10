import { useState } from 'react';
import {
  deleteDomain,
  refreshSSL,
  getDomainCerts,
  refreshDomainCerts,
} from '../api.js';

const STATUS_META = {
  valid: { label: 'Valid', className: 'status-valid' },
  expiring: { label: 'Expiring soon', className: 'status-expiring' },
  expired: { label: 'EXPIRED', className: 'status-expired' },
  'issued-not-deployed': { label: 'Renewed, not deployed', className: 'status-notdeployed' },
  'scan-failed': { label: 'Scan failed', className: 'status-scanfailed' },
  unknown: { label: 'Unknown', className: 'status-unknown' },
  'not-scanned': { label: 'Not scanned', className: 'status-unknown' },
};

const STATUS_ACCENT = {
  valid: '#10b981',
  expiring: '#f59e0b',
  expired: '#ef4444',
  'issued-not-deployed': '#8b5cf6',
  'scan-failed': '#94a3b8',
  unknown: '#c3cbd8',
  'not-scanned': '#c3cbd8',
};

export const RISK_STATUSES = ['expiring', 'issued-not-deployed', 'scan-failed'];
export const HEALTHY_STATUSES = ['valid', 'unknown', 'not-scanned'];

export function effectiveStatus(domain) {
  return domain.last_synced_at ? domain.cert_status || 'unknown' : 'not-scanned';
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.unknown;
  return <span className={`status-badge ${meta.className}`}>{meta.label}</span>;
}

function formatSSLDate(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function DayChip({ iso }) {
  if (!iso) return <span className="day-chip day-plain">no cert data</span>;
  const diff = new Date(iso).getTime() - Date.now();
  const d = Math.ceil(diff / 86400000);
  let cls = 'day-plain';
  let label;
  if (d < 0) {
    cls = 'day-expired';
    label = `expired ${Math.abs(d)}d ago`;
  } else if (d <= 60) {
    cls = '';
    label = `expires in ${d}d`;
  } else {
    cls = 'day-valid';
    label = `expires in ${d}d`;
  }
  return <span className={`day-chip ${cls}`}>{label}</span>;
}

const icons = {
  view: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  ),
  refresh: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
};

function CertPanel({ payload, refreshing, onScanNow }) {
  const { status, certs = [], servedCert } = payload;
  const newestIssued = certs.length ? certs[0] : null;

  return (
    <div className="cert-panel-inner">
      <div className="cert-panel-header">
        <StatusBadge status={status} />
        <button className="btn btn-primary btn-small" onClick={onScanNow} disabled={refreshing}>
          {refreshing ? 'Scanning…' : 'Scan now'}
        </button>
      </div>

      {status === 'issued-not-deployed' && (
        <div className="cert-alert">
          ⚠ A new certificate was issued (per CT logs) but this server is still serving an
          older one. The renewal happened on paper but was <strong>never deployed</strong> —
          it will break when the served certificate expires.
        </div>
      )}

      {servedCert ? (
        <p className="cert-served">
          <span className="dot" />
          <strong>{servedCert.host}</strong> · {servedCert.common_name || '—'} ·
          expires {formatSSLDate(servedCert.not_after)}
        </p>
      ) : (
        <p className="cert-served cert-served-none">No TLS endpoint responding.</p>
      )}

      {certs.length === 0 ? (
        <p className="cert-empty">
          No certificates found in CT logs yet. Hit “Scan now” — CT discovery usually
          populates within a minute.
        </p>
      ) : (
        <table className="cert-table">
          <thead>
            <tr>
              <th>Certificate</th>
              <th>Issuer</th>
              <th>Expires</th>
              <th>Days</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {certs.map((c) => {
              const isNewestNotServed =
                newestIssued && newestIssued.serial === c.serial && !c.is_served;
              return (
                <tr key={c.serial}>
                  <td>
                    <span className="cert-cn">{c.common_name || c.serial}</span>
                    {c.is_served && <span className="cert-tag tag-served">served</span>}
                    {isNewestNotServed && <span className="cert-tag tag-new">new, not deployed</span>}
                  </td>
                  <td>{c.issuer || '—'}</td>
                  <td>{formatSSLDate(c.not_after)}</td>
                  <td>{daysLeft(c.not_after)}</td>
                  <td><StatusBadge status={c.cert_status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function daysLeft(iso) {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  const d = Math.ceil(diff / 86400000);
  return `${d}d`;
}

export default function DomainList({ domains, onEdit, onRefresh }) {
  const [expandedId, setExpandedId] = useState(null);
  const [certPayload, setCertPayload] = useState(null);
  const [certLoading, setCertLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  async function toggleCerts(domain) {
    if (expandedId === domain.id) {
      setExpandedId(null);
      setCertPayload(null);
      return;
    }
    setExpandedId(domain.id);
    setCertPayload(null);
    setCertLoading(true);
    try {
      setCertPayload(await getDomainCerts(domain.id));
    } catch (err) {
      alert('Failed to load certificates.');
    } finally {
      setCertLoading(false);
    }
  }

  async function handleScanNow(domain) {
    setRefreshing(true);
    try {
      setCertPayload(await refreshDomainCerts(domain.id));
      await onRefresh(); // update domain badge/count in the list
    } catch (err) {
      alert('Scan failed.');
    } finally {
      setRefreshing(false);
    }
  }

  if (domains.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <p>No domains yet</p>
        <p>Click “Add Domain” to start discovering certificates for a client domain.</p>
      </div>
    );
  }

  return (
    <div className="domain-list">
      {domains.map((domain) => {
        const status = effectiveStatus(domain);
        const accent = STATUS_ACCENT[status] || '#c3cbd8';
        const isExpanded = expandedId === domain.id;

        return (
          <div
            key={domain.id}
            className={`domain-card${isExpanded ? ' expanded' : ''}`}
            style={{ '--accent': accent }}
          >
            <div className="domain-card-body">
              <div className="domain-heading">
                <span className="domain-name">{domain.domain_name}</span>
                <StatusBadge status={status} />
              </div>
              {domain.notes && <div className="domain-notes">{domain.notes}</div>}
              <div className="domain-meta">
                <DayChip iso={domain.ssl_renewal} />
                <span className="meta-sep">·</span>
                <span className="domain-ssl">
                  {domain.ssl_renewal
                    ? `served cert expires ${formatSSLDate(domain.ssl_renewal)}`
                    : 'no served certificate'}
                </span>
                <span className="meta-sep">·</span>
                <span className="domain-cert-count">
                  {domain.cert_count || 0} certs in CT history
                </span>
              </div>

              {isExpanded && (
                <div className="cert-panel">
                  {certLoading ? (
                    <p className="loading-text">Loading certificates…</p>
                  ) : certPayload ? (
                    <CertPanel
                      payload={certPayload}
                      refreshing={refreshing}
                      onScanNow={() => handleScanNow(domain)}
                    />
                  ) : null}
                </div>
              )}
            </div>

            <div className="domain-card-actions">
              <button className="btn btn-secondary btn-small" onClick={() => toggleCerts(domain)}>
                {icons.view}
                {isExpanded ? 'Hide certs' : 'View certs'}
              </button>
              <button className="btn btn-secondary btn-small" onClick={() => onEdit(domain)}>
                {icons.edit}
                Edit
              </button>
              <button
                className="btn btn-secondary btn-small"
                onClick={() => handleRefreshSSL(domain.id)}
              >
                {icons.refresh}
                Rescan
              </button>
              <button
                className="btn btn-danger btn-small"
                onClick={() => handleDelete(domain.id, domain.domain_name)}
              >
                {icons.trash}
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
