const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('lpu_token');
}

export function setStoredToken(token: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('lpu_token', token);
  }
}

export function clearStoredToken() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('lpu_token');
  }
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
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
    throw new Error(data.error || data.message || `Request failed with status ${response.status}`);
  }

  return data;
}

// API Methods
export const api = {
  auth: {
    login: (body: any) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    register: (body: any) => apiRequest('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
    demoLogin: (role: string) => apiRequest('/auth/demo-login', { method: 'POST', body: JSON.stringify({ role }) }),
    me: () => apiRequest('/auth/me'),
  },
  dashboard: {
    getStats: () => apiRequest('/dashboard/stats'),
  },
  resources: {
    list: (params?: Record<string, string>) => {
      const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
      return apiRequest(`/resources${qs}`);
    },
    getById: (id: string) => apiRequest(`/resources/${id}`),
    smartAllocation: (body: any) => apiRequest('/resources/smart-allocation', { method: 'POST', body: JSON.stringify(body) }),
  },
  timetable: {
    list: (params?: Record<string, string>) => {
      const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
      return apiRequest(`/timetable${qs}`);
    },
  },
  bookings: {
    create: (body: any) => apiRequest('/bookings', { method: 'POST', body: JSON.stringify(body) }),
    list: (params?: Record<string, string>) => {
      const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
      return apiRequest(`/bookings${qs}`);
    },
    getById: (id: string) => apiRequest(`/bookings/${id}`),
    cancel: (id: string, reason?: string) => apiRequest(`/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  },
  approvals: {
    list: (status?: string) => {
      const qs = status ? `?status=${status}` : '';
      return apiRequest(`/approvals${qs}`);
    },
    takeAction: (id: string, body: any) => apiRequest(`/approvals/${id}/action`, { method: 'POST', body: JSON.stringify(body) }),
  },
  checkin: {
    verify: (body: { token?: string; bookingId?: string }) => apiRequest('/checkin/verify', { method: 'POST', body: JSON.stringify(body) }),
    autoReleaseScan: () => apiRequest('/checkin/auto-release-scan', { method: 'POST' }),
  },
  notifications: {
    list: () => apiRequest('/notifications'),
    markRead: (id: string) => apiRequest(`/notifications/${id}/read`, { method: 'PUT' }),
    markAllRead: () => apiRequest('/notifications/read-all', { method: 'PUT' }),
  },
  admin: {
    getUsers: () => apiRequest('/admin/users'),
    updateUserRole: (id: string, role: string) => apiRequest(`/admin/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
    createResource: (body: any) => apiRequest('/admin/resources', { method: 'POST', body: JSON.stringify(body) }),
    updateResource: (id: string, body: any) => apiRequest(`/admin/resources/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    deleteResource: (id: string) => apiRequest(`/admin/resources/${id}`, { method: 'DELETE' }),
    getPolicies: () => apiRequest('/admin/policies'),
    updatePolicy: (id: string, body: any) => apiRequest(`/admin/policies/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    getAuditLogs: () => apiRequest('/admin/audit-logs'),
  },
};
