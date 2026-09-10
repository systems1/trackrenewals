import { useEffect, useState, useRef } from 'react';
import Navbar from './Navbar.jsx';
import DomainList, { effectiveStatus, RISK_STATUSES, HEALTHY_STATUSES } from './DomainList.jsx';
import DomainForm from './DomainForm.jsx';
import { getDomains, createDomain, updateDomain, importDomainsCSV, exportDomainsCSV } from '../api.js';

const FILTERS = {
  all: { label: 'All', match: () => true },
  risk: { label: 'At risk', match: (s) => RISK_STATUSES.includes(s) },
  expired: { label: 'Expired', match: (s) => s === 'expired' },
  healthy: { label: 'Healthy', match: (s) => HEALTHY_STATUSES.includes(s) },
};

const STAT_CARDS = [
  { key: 'all', icon: 'total', label: 'Total domains' },
  { key: 'healthy', icon: 'healthy', label: 'Healthy' },
  { key: 'risk', icon: 'risk', label: 'At risk' },
  { key: 'expired', icon: 'critical', label: 'Expired' },
];

function StatIcon({ kind }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  switch (kind) {
    case 'total':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3.6 9h16.8" />
          <path d="M3.6 15h16.8" />
          <path d="M12 3a15 15 0 0 1 0 18" />
          <path d="M12 3a15 15 0 0 0 0 18" />
        </svg>
      );
    case 'healthy':
      return (
        <svg {...common}>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <path d="M22 4L12 14.01l-3-3" />
        </svg>
      );
    case 'risk':
      return (
        <svg {...common}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      );
    case 'critical':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <path d="M15 9l-6 6" />
          <path d="M9 9l6 6" />
        </svg>
      );
    default:
      return null;
  }
}

export default function Dashboard() {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editDomain, setEditDomain] = useState(null);
  const [importStatus, setImportStatus] = useState('');
  const [filter, setFilter] = useState('all');
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchDomains();
  }, []);

  async function fetchDomains() {
    setLoading(true);
    try {
      const data = await getDomains();
      setDomains(data);
    } catch (err) {
      // silently handle — empty list shown
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(data) {
    if (editDomain) {
      await updateDomain(editDomain.id, data);
    } else {
      await createDomain(data);
    }
    setShowForm(false);
    setEditDomain(null);
    await fetchDomains();
  }

  function handleEdit(domain) {
    setEditDomain(domain);
    setShowForm(true);
  }

  function handleCancel() {
    setShowForm(false);
    setEditDomain(null);
  }

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const result = await importDomainsCSV(file);
      setImportStatus(`Imported ${result.imported}, skipped ${result.skipped}`);
      await fetchDomains();
    } catch (err) {
      setImportStatus('Import failed.');
      console.error(err);
    }
    e.target.value = '';
  }

  async function handleExport() {
    try {
      const blob = await exportDomainsCSV();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'domains.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed.');
    }
  }

  const statuses = domains.map(effectiveStatus);
  const counts = {
    all: domains.length,
    healthy: statuses.filter((s) => HEALTHY_STATUSES.includes(s)).length,
    risk: statuses.filter((s) => RISK_STATUSES.includes(s)).length,
    expired: statuses.filter((s) => s === 'expired').length,
  };

  const visible = domains.filter((d) => FILTERS[filter].match(effectiveStatus(d)));

  return (
    <div className="dashboard">
      <Navbar />
      <main className="dashboard-main">
        <div className="dashboard-header">
          <div>
            <h2>Certificate Overview</h2>
            <p className="page-sub">
              {domains.length === 0
                ? 'Add your first client domain to start discovering certificates.'
                : `${counts.risk + counts.expired > 0 ? `${counts.risk + counts.expired} need attention · ` : ''}everything else is healthy.`}
            </p>
          </div>
          <div className="dashboard-header-actions">
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv"
              style={{ display: 'none' }}
              onChange={handleImport}
            />
            <button
              className="btn btn-secondary"
              onClick={() => fileInputRef.current.click()}
            >
              Import CSV
            </button>
            <button className="btn btn-secondary" onClick={handleExport}>
              Export CSV
            </button>
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              + Add Domain
            </button>
          </div>
        </div>

        {importStatus && <p className="import-status">{importStatus}</p>}

        {!loading && domains.length > 0 && (
          <>
            <div className="stats-grid">
              {STAT_CARDS.map((card) => (
                <button
                  key={card.key}
                  className="stat-card"
                  onClick={() => setFilter(card.key)}
                  style={{ borderColor: filter === card.key ? 'var(--color-primary)' : undefined }}
                >
                  <span className={`stat-icon stat-${card.icon}`}>
                    <StatIcon kind={card.icon} />
                  </span>
                  <span>
                    <div className="stat-value">{counts[card.key]}</div>
                    <div className="stat-label">{card.label}</div>
                  </span>
                </button>
              ))}
            </div>

            <div className="filter-bar">
              {Object.entries(FILTERS).map(([key, f]) => (
                <button
                  key={key}
                  className={`filter-btn${filter === key ? ' active' : ''}`}
                  onClick={() => setFilter(key)}
                >
                  {f.label}
                </button>
              ))}
              <span className="filter-count">{visible.length} shown</span>
            </div>
          </>
        )}

        {loading ? (
          <p className="loading-text">Loading…</p>
        ) : (
          <DomainList
            domains={visible}
            onEdit={handleEdit}
            onRefresh={fetchDomains}
            activeFilter={filter}
          />
        )}
      </main>

      {showForm && (
        <DomainForm domain={editDomain} onSave={handleSave} onCancel={handleCancel} />
      )}
    </div>
  );
}
