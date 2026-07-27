import { useEffect, useState, useRef } from 'react';
import Navbar from './Navbar.jsx';
import DomainList from './DomainList.jsx';
import DomainForm from './DomainForm.jsx';
import { getDomains, createDomain, updateDomain, importDomainsCSV, exportDomainsCSV } from '../api.js';

export default function Dashboard() {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editDomain, setEditDomain] = useState(null);
  const [importStatus, setImportStatus] = useState('');
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

  return (
    <div className="dashboard">
      <Navbar />
      <main className="dashboard-main">
        <div className="dashboard-header">
          <h2>My Domains</h2>
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
              Add Domain
            </button>
          </div>
        </div>

        {importStatus && <p className="import-status">{importStatus}</p>}

        {loading ? (
          <p className="loading-text">Loading...</p>
        ) : (
          <DomainList domains={domains} onEdit={handleEdit} onRefresh={fetchDomains} />
        )}
      </main>

      {showForm && (
        <DomainForm domain={editDomain} onSave={handleSave} onCancel={handleCancel} />
      )}
    </div>
  );
}