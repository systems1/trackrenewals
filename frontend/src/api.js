const BASE_URL = '';

async function request(path, options = {}) {
  const res = await fetch(BASE_URL + path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return res.json();
}

export async function getMe() {
  return request('/api/auth/me');
}

export async function getDomains() {
  return request('/api/domains');
}

export async function createDomain(data) {
  return request('/api/domains', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateDomain(id, data) {
  return request(`/api/domains/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteDomain(id) {
  return request(`/api/domains/${id}`, {
    method: 'DELETE',
  });
}

export async function refreshSSL(id) {
  return request(`/api/domains/${id}/refresh-ssl`, {
    method: 'POST',
  });
}

export async function importDomainsCSV(file) {
  const formData = new FormData();
  formData.append('csvFile', file);

  const res = await fetch(BASE_URL + '/api/domains/import', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function exportDomainsCSV() {
  const res = await fetch(BASE_URL + '/api/domains/export', {
    method: 'GET',
    credentials: 'include',
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.blob();
}