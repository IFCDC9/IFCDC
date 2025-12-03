const API_BASE = '/api';

export async function apiRequest(path, options = {}, token) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    const storedToken = localStorage.getItem('ifcdc_token');
    if (storedToken) {
      headers['Authorization'] = `Bearer ${storedToken}`;
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    localStorage.removeItem('ifcdc_token');
    localStorage.removeItem('ifcdc_user');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = `Request failed with status ${res.status}`;
    try {
      const json = JSON.parse(text);
      message = json.message || message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }

  if (res.status === 204) {
    return null;
  }

  return res.json();
}

export default apiRequest;
