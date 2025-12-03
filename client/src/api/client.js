const API_BASE = '/api';

export async function apiClient(endpoint, options = {}) {
  const token = localStorage.getItem('ifcdc_token');
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    localStorage.removeItem('ifcdc_token');
    localStorage.removeItem('ifcdc_user');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export default apiClient;
