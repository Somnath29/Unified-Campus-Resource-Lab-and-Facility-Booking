import { ResourceDTO, ResourceCategory, BookingStatus, ActivityType } from './index';

// -------------------------------------------------------------
// Resource Discovery & Pagination Types
// -------------------------------------------------------------

export type ResourceSortField = 'name' | 'capacity' | 'category' | 'building' | 'createdAt';
export type SortOrder = 'asc' | 'desc';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface ResourceListResponse {
  resources: ResourceDTO[];
  pagination: PaginationMeta;
}

// -------------------------------------------------------------
// Daily Availability Types (30-minute slots)
// -------------------------------------------------------------

export type AvailabilitySlotStatus =
  | 'available'
  | 'booked'
  | 'class'
  | 'maintenance'
  | 'blackout'
  | 'outside_hours';

export interface AvailabilitySlot {
  startTime: string; // "HH:mm" in Asia/Kolkata
  endTime: string;   // "HH:mm" in Asia/Kolkata
  startUtc: string;  // ISO timestamp
  endUtc: string;    // ISO timestamp
  status: AvailabilitySlotStatus;
  reason: string;
  conflicts?: AvailabilitySlotStatus[];
}

export interface ResourceAvailabilityResponse {
  resourceId: string;
  resourceName: string;
  date: string; // YYYY-MM-DD
  timezone: string; // "Asia/Kolkata"
  slotDurationMinutes: number; // 30
  operatingHours: string;
  slots: AvailabilitySlot[];
}

// -------------------------------------------------------------
// Resource Calendar Types (Strict Privacy)
// -------------------------------------------------------------

export type CalendarEventType = 'BOOKING' | 'CLASS';

export interface BaseCalendarEvent {
  id: string;
  start: string;    // "YYYY-MM-DD HH:mm" in Asia/Kolkata
  end: string;      // "YYYY-MM-DD HH:mm" in Asia/Kolkata
  startUtc: string; // ISO
  endUtc: string;   // ISO
  title: string;    // "Booked" for non-owners, or actual title
  isOwner: boolean;
}

export interface BookingCalendarEvent extends BaseCalendarEvent {
  type: 'BOOKING';
  status: BookingStatus;
  purpose?: string;       // Only included when isOwner is true
  activityType?: ActivityType; // Only included when isOwner is true
}

export interface TimetableCalendarEvent extends BaseCalendarEvent {
  type: 'CLASS';
  courseCode?: string;
  instructorName?: string;
  isOwner: false;
}

export type CalendarEvent = BookingCalendarEvent | TimetableCalendarEvent;

export interface ResourceCalendarResponse {
  resourceId: string;
  resourceName: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  timezone: string; // "Asia/Kolkata"
  events: CalendarEvent[];
}
