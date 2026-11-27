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

  // Always use relative /api endpoint with credentials included
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = path.startsWith('/api') ? path : `/api${path}`;

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error: any = new Error(data.error || data.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
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
    logout: () => apiRequest('/auth/logout', { method: 'POST' }),
  },
  dashboard: {
    getStats: () => apiRequest<import('@lpu/shared').DashboardDataResponse>('/dashboard'),
  },
  resources: {
    list: (params?: Record<string, string | number | boolean | undefined>) => {
      const filteredParams = new URLSearchParams();
      if (params) {
        Object.entries(params).forEach(([key, val]) => {
          if (val !== undefined && val !== null && val !== '') {
            filteredParams.set(key, String(val));
          }
        });
      }
      const qs = filteredParams.toString() ? `?${filteredParams.toString()}` : '';
      return apiRequest<import('@lpu/shared').ResourceListResponse>(`/resources${qs}`);
    },
    getById: (id: string) => apiRequest<import('@lpu/shared').ResourceDTO>(`/resources/${id}`),
    getAvailability: (id: string, date: string) =>
      apiRequest<import('@lpu/shared').ResourceAvailabilityResponse>(
        `/resources/${id}/availability?date=${encodeURIComponent(date)}`
      ),
    getCalendar: (id: string, from: string, to: string) =>
      apiRequest<import('@lpu/shared').ResourceCalendarResponse>(
        `/resources/${id}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      ),
    recommendations: (params?: Record<string, any>) => {
      const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
      return apiRequest<import('@lpu/shared').ResourceRecommendationResponse>(`/resources/recommendations${qs}`);
    },
    smartAllocation: (body: any) => apiRequest('/resources/smart-allocation', { method: 'POST', body: JSON.stringify(body) }),
  },
  timetable: {
    list: (params?: Record<string, string>) => {
      const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
      return apiRequest(`/timetable${qs}`);
    },
  },
  bookings: {
    preview: (body: import('@lpu/shared').BookingPreviewRequest) =>
      apiRequest<import('@lpu/shared').BookingPreviewResponse>('/bookings/preview', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    create: (body: any, idempotencyKey?: string) =>
      apiRequest('/bookings', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Idempotency-Key':
            idempotencyKey ||
            (typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`),
        },
      }),
    list: (params?: Record<string, string>) => {
      const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
      return apiRequest(`/bookings${qs}`);
    },
    getById: (id: string) => apiRequest(`/bookings/${id}`),
    my: (params?: Record<string, any>) => {
      const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
      return apiRequest<import('@lpu/shared').MyBookingsResponse>(`/bookings/my${qs}`);
    },
    reschedule: (id: string, body: import('@lpu/shared').RescheduleBookingRequest) =>
      apiRequest<import('@lpu/shared').RescheduleBookingResponse>(`/bookings/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    endEarly: (id: string) =>
      apiRequest<import('@lpu/shared').EndEarlyBookingResponse>(`/bookings/${id}/end-early`, {
        method: 'POST',
      }),
    extend: (id: string, durationMinutes: number) =>
      apiRequest<import('@lpu/shared').ExtendBookingResponse>(`/bookings/${id}/extend`, {
        method: 'POST',
        body: JSON.stringify({ durationMinutes }),
      }),
    cancel: (id: string, reason?: string, scope?: import('@lpu/shared').OccurrenceCancellationScope) =>
      apiRequest<import('@lpu/shared').CancelBookingResponse>(`/bookings/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason, scope }),
      }),
    createSeries: (body: import('@lpu/shared').BookingSeriesRequest, idempotencyKey?: string) =>
      apiRequest<import('@lpu/shared').BookingSeriesResponse>('/bookings/series', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Idempotency-Key':
            idempotencyKey ||
            (typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`),
        },
      }),
    previewSeries: (body: import('@lpu/shared').BookingSeriesPreviewRequest) =>
      apiRequest<import('@lpu/shared').BookingSeriesPreviewResponse>('/bookings/series/preview', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    cancelSeries: (seriesId: string, body: import('@lpu/shared').SeriesCancellationRequest) =>
      apiRequest<import('@lpu/shared').SeriesCancellationResponse>(`/bookings/series/${seriesId}/cancel`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
  waitlist: {
    join: (body: import('@lpu/shared').JoinWaitlistRequest) =>
      apiRequest<import('@lpu/shared').JoinWaitlistResponse>('/waitlist', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    list: (query?: import('@lpu/shared').WaitlistQuery) => {
      const params = new URLSearchParams();
      if (query?.status) params.set('status', query.status);
      if (query?.page) params.set('page', query.page.toString());
      if (query?.limit) params.set('limit', query.limit.toString());
      const qs = params.toString() ? `?${params.toString()}` : '';
      return apiRequest<import('@lpu/shared').WaitlistListResponse>(`/waitlist${qs}`);
    },
    leave: (id: string) =>
      apiRequest<import('@lpu/shared').LeaveWaitlistResponse>(`/waitlist/${id}`, {
        method: 'DELETE',
      }),
    accept: (id: string) =>
      apiRequest<import('@lpu/shared').AcceptOfferResponse>(`/waitlist/${id}/accept`, {
        method: 'POST',
      }),
  },
  me: {
    quota: (date?: string) => {
      const qs = date ? `?date=${encodeURIComponent(date)}` : '';
      return apiRequest<import('@lpu/shared').QuotaResponse>(`/me/quota${qs}`);
    },
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
