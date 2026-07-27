import { useState } from 'react';

export default function DomainForm({ domain, onSave, onCancel }) {
  const [domainName, setDomainName] = useState(domain?.domain_name || '');
  const [notes, setNotes] = useState(domain?.notes || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const trimmedName = domainName.trim();
    if (!trimmedName) {
      setError('Domain name is required.');
      return;
    }

    setSaving(true);
    try {
      await onSave({ domain_name: trimmedName, notes: notes.trim() });
    } catch (err) {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function formatSSLDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{domain ? 'Edit Domain' : 'Add Domain'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="domain_name">Domain Name</label>
            <input
              id="domain_name"
              type="text"
              value={domainName}
              onChange={(e) => setDomainName(e.target.value)}
              placeholder="example.com"
              disabled={!!domain || saving}
            />
          </div>
          <div className="form-group">
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about this domain..."
              rows={4}
            />
          </div>
          {domain && (
            <div className="form-group">
              <label>SSL Status</label>
              {domain.ssl_renewal ? (
                <p className="form-ssl-status">SSL certificate expires: {formatSSLDate(domain.ssl_renewal)}</p>
              ) : (
                <p className="form-ssl-status form-ssl-none">No SSL certificate detected</p>
              )}
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}