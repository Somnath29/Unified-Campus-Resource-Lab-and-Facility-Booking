const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export function getAdminToken(): string | null {
  return localStorage.getItem('lpu_admin_token') || localStorage.getItem('lpu_token');
}

export function setAdminToken(token: string) {
  localStorage.setItem('lpu_admin_token', token);
}

export function clearAdminToken() {
  localStorage.removeItem('lpu_admin_token');
  localStorage.removeItem('lpu_token');
}

export async function adminApiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAdminToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${API_BASE}${cleanEndpoint}`;

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (response.status === 401) {
    clearAdminToken();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || `API error: ${response.status}`);
  }

  return data;
}

export const adminApi = {
  auth: {
    login: (body: any) =>
      adminApiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    demoLogin: (role: string = 'ADMINISTRATOR') =>
      adminApiRequest('/auth/demo-login', {
        method: 'POST',
        body: JSON.stringify({ role }),
      }),
    logout: () =>
      adminApiRequest('/auth/logout', {
        method: 'POST',
      }),
    me: () => adminApiRequest('/auth/me'),
  },
  analytics: {
    getOverview: () => adminApiRequest('/analytics/overview'),
  },
  resources: {
    list: () => adminApiRequest('/resources?includeMaintenance=true'),
    create: (body: any) =>
      adminApiRequest('/admin/resources', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: any) =>
      adminApiRequest(`/admin/resources/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: string) =>
      adminApiRequest(`/admin/resources/${id}`, { method: 'DELETE' }),
  },
  users: {
    list: () => adminApiRequest('/admin/users'),
    updateRole: (id: string, role: string) =>
      adminApiRequest(`/admin/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  },
  policies: {
    list: () => adminApiRequest('/admin/policies'),
    update: (id: string, body: any) =>
      adminApiRequest(`/admin/policies/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  },
  audit: {
    list: () => adminApiRequest('/admin/audit-logs'),
  },
};
