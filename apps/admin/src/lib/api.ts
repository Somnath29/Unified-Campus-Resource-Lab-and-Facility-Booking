const API_BASE = 'http://localhost:5001/api';

export function getAdminToken(): string | null {
  return localStorage.getItem('lpu_admin_token') || localStorage.getItem('lpu_token');
}

export function setAdminToken(token: string) {
  localStorage.setItem('lpu_admin_token', token);
}

export async function adminApiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  let token = getAdminToken();

  // If no token exists, automatically obtain one using the admin demo account
  if (!token) {
    try {
      const loginRes = await fetch(`${API_BASE}/auth/demo-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'ADMINISTRATOR' }),
      });
      const data = await loginRes.json();
      if (data.token) {
        token = data.token;
        setAdminToken(token as string);
      }
    } catch (e) {
      console.warn('Auto admin login failed:', e);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || `API error: ${response.status}`);
  }

  return data;
}

export const adminApi = {
  analytics: {
    getOverview: () => adminApiRequest('/analytics/overview'),
  },
  resources: {
    list: () => adminApiRequest('/resources?includeMaintenance=true'),
    create: (body: any) => adminApiRequest('/admin/resources', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: any) => adminApiRequest(`/admin/resources/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: string) => adminApiRequest(`/admin/resources/${id}`, { method: 'DELETE' }),
  },
  users: {
    list: () => adminApiRequest('/admin/users'),
    updateRole: (id: string, role: string) => adminApiRequest(`/admin/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  },
  policies: {
    list: () => adminApiRequest('/admin/policies'),
    update: (id: string, body: any) => adminApiRequest(`/admin/policies/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  },
  audit: {
    list: () => adminApiRequest('/admin/audit-logs'),
  },
};
