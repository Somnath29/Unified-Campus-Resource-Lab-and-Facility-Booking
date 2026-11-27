export const NOTIFICATION_PREFERENCE_CATEGORIES = [
  'BOOKING_CONFIRMED',
  'BOOKING_APPROVED',
  'BOOKING_REJECTED',
  'BOOKING_CANCELLED',
  'BOOKING_RESCHEDULED',
  'UPCOMING_REMINDER',
  'AUTO_RELEASE_WARNING',
  'WAITLIST_OFFER',
  'WAITLIST_EXPIRED',
  'BOOKING_COMPLETED',
  'SYSTEM',
] as const;

export type NotificationPreferenceCategory =
  (typeof NOTIFICATION_PREFERENCE_CATEGORIES)[number];

export interface NotificationItemDTO {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  readAt?: string | null;
  link?: string | null;
  createdAt: string;
}

export interface NotificationsListResponse {
  notifications: NotificationItemDTO[];
  unreadCount: number;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface NotificationPreferenceDTO {
  notificationType: NotificationPreferenceCategory;
  label: string;
  description: string;
  emailEnabled: boolean;
  reminderLeadMinutes: number;
}

export interface NotificationPreferencesResponse {
  preferences: NotificationPreferenceDTO[];
  reminderLeadMinutes: number;
}

export interface UpdateNotificationPreferencesRequest {
  reminderLeadMinutes?: number;
  preferences: Array<{
    notificationType: NotificationPreferenceCategory;
    emailEnabled: boolean;
  }>;
}

export interface UserProfileDTO {
  id: string;
  email: string;
  name: string;
  role: string;
  department: string;
  regNo?: string | null;
  designation?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  passwordChangedAt?: string | null;
}

export interface UpdateProfileRequest {
  name: string;
  phone?: string | null;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword?: string;
}

export interface UserSessionDTO {
  id: string;
  deviceLabel: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export interface ActiveSessionsResponse {
  sessions: UserSessionDTO[];
}

export interface CalendarFeedStatusResponse {
  hasActiveFeed: boolean;
  createdAt?: string | null;
  lastUsedAt?: string | null;
}

export interface RegenerateCalendarFeedResponse {
  feedUrl: string;
  createdAt: string;
  message: string;
}

export interface ReminderJobResponse {
  upcomingProcessed: number;
  upcomingSent: number;
  autoReleaseProcessed: number;
  autoReleaseSent: number;
  retriesProcessed: number;
  retriesSent: number;
  message: string;
}
