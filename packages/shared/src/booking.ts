import { ActivityType, BookingStatus, PriorityLevel, ResourceCategory, ResourceDTO, BookingDTO } from './index';

export interface AlternativeSlot {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  durationMinutes: number;
}

export interface BookingPreviewRequest {
  resourceId: string;
  startTime: string; // ISO or YYYY-MM-DDTHH:mm
  endTime: string;   // ISO or YYYY-MM-DDTHH:mm
  expectedAttendance?: number;
  activityType?: ActivityType;
  purpose?: string;
}

export type PolicyDecisionType = 'AUTO_CONFIRMED' | 'REQUIRES_APPROVAL' | 'POLICY_REFUSAL';

export interface BookingPreviewResponse {
  allowed: boolean;
  decision: PolicyDecisionType;
  requiresApproval: boolean;
  initialStatus: BookingStatus;
  reason?: string;
  remainingWeeklyQuota: number; // in hours
  maxWeeklyHours: number;       // in hours
  currentWeeklyHours: number;   // in hours
  policyMessages: string[];
  alternativeSlots?: AlternativeSlot[];
  resource?: {
    id: string;
    name: string;
    capacity: number;
    operatingHours: string;
    department: string;
  };
}

export interface DashboardStats {
  totalBookings: number;
  upcomingBookingsCount: number;
  completedBookingsCount: number;
  pendingRequestsCount: number;
  cancelledBookingsCount: number;
  availableResourcesCount: number;
  clubBookingsCount: number;
  remainingWeeklyQuota: number;
  maxWeeklyHours: number;
  currentWeeklyHours: number;
}

export interface DashboardDataResponse {
  stats: DashboardStats;
  upcomingBookings: BookingDTO[];
  recentActivity: Array<{
    id: string;
    action: string;
    createdAt: string;
    details?: string | null;
    booking?: {
      bookingNumber: string;
      resourceName?: string;
    };
  }>;
  recommendedResources: ResourceDTO[];
  timetableClasses: any[];
}

export interface ResourceRecommendationRequest {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime?: string; // HH:mm
  durationMinutes?: number;
  expectedAttendance: number;
  preferredBuilding?: string;
  requiredAmenities?: string[];
  category?: ResourceCategory;
}

export interface ResourceRecommendationItem {
  resource: ResourceDTO;
  rankingScore: number;
  reason: string;
  capacityFitRatio: number;
  matchedAmenities: string[];
  buildingMatch: boolean;
  isAvailable: boolean;
}

export interface ResourceRecommendationResponse {
  recommendations: ResourceRecommendationItem[];
  totalMatches: number;
  criteria: {
    date: string;
    startTime: string;
    endTime: string;
    expectedAttendance: number;
    preferredBuilding?: string;
    requiredAmenities?: string[];
    category?: string;
  };
}

// -------------------------------------------------------------
// R5 Recurring Bookings, Series & Quota Meter Contracts
// -------------------------------------------------------------

export type RecurrenceFrequency = 'DAILY' | 'WEEKLY';

export type Weekday =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

export type BookingSeriesMode = 'ATOMIC' | 'PARTIAL';

export type OccurrenceCancellationScope = 'ONE' | 'THIS_AND_FOLLOWING' | 'ENTIRE_SERIES';

export type BookingOccurrenceStatus =
  | 'AVAILABLE'
  | 'CREATED'
  | 'REQUIRES_APPROVAL'
  | 'CONFLICT'
  | 'TIMETABLE_CLASH'
  | 'POLICY_REFUSAL'
  | 'INVALID'
  | 'SKIPPED_ATOMIC_FAILURE';

export interface BookingOccurrence {
  date: string; // YYYY-MM-DD in Asia/Kolkata
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  durationMinutes: number;
  sequenceNumber: number;
  startUtc: string; // ISO
  endUtc: string;   // ISO
}

export interface BookingOccurrenceResult {
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  sequenceNumber: number;
  status: BookingOccurrenceStatus;
  isCreated: boolean;
  bookingId?: string;
  bookingNumber?: string;
  approvalStatus?: BookingStatus;
  reason?: string;
  conflictReason?: string;
  remainingWeeklyQuota?: number;
  autoReleaseMinutes?: number;
}

export interface BookingSeriesDTO {
  id: string;
  userId: string;
  resourceId: string;
  resource?: ResourceDTO;
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: string[];
  startDate: string;
  until?: string | null;
  count?: number | null;
  timeOfDay: string;
  duration: number;
  createdAt: string;
  updatedAt: string;
  bookings?: BookingDTO[];
}

export interface BookingSeriesRequest {
  resourceId: string;
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays?: string[];
  startDate: string; // YYYY-MM-DD
  until?: string;    // YYYY-MM-DD
  count?: number;    // positive integer <= 16
  startTime: string; // HH:mm
  endTime?: string;  // HH:mm
  durationMinutes?: number;
  expectedAttendance: number;
  activityType: ActivityType;
  purpose: string;
  bookingMode: BookingSeriesMode;
  priority?: PriorityLevel;
}

export interface BookingSeriesResponse {
  seriesId?: string;
  bookingMode: BookingSeriesMode;
  totalOccurrences: number;
  successfulCount: number;
  failedCount: number;
  results: BookingOccurrenceResult[];
  message: string;
}

export interface BookingSeriesPreviewRequest {
  resourceId: string;
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays?: string[];
  startDate: string;
  until?: string;
  count?: number;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  expectedAttendance: number;
  activityType?: ActivityType;
  purpose?: string;
}

export interface WeeklyQuotaBreakdown {
  weekStart: string; // YYYY-MM-DD
  weekEnd: string;   // YYYY-MM-DD
  maxWeeklyHours: number;
  alreadyBookedHours: number;
  seriesRequestedHours: number;
  remainingQuotaAfterSeries: number;
  isExceeded: boolean;
}

export interface BookingSeriesPreviewResponse {
  totalOccurrences: number;
  validOccurrencesCount: number;
  conflictingOccurrencesCount: number;
  occurrences: BookingOccurrenceResult[];
  weeklyBreakdowns: WeeklyQuotaBreakdown[];
}

export interface SeriesCancellationRequest {
  scope: OccurrenceCancellationScope;
  targetBookingId?: string;
  reason?: string;
}

export interface SeriesCancellationResponse {
  scope: OccurrenceCancellationScope;
  cancelledCount: number;
  skippedCount: number;
  cancelledBookingIds: string[];
  failedBookingIds?: { id: string; reason: string }[];
  message: string;
}

export interface QuotaResponse {
  periodStart: string; // YYYY-MM-DD or ISO
  periodEnd: string;   // YYYY-MM-DD or ISO
  currentWeeklyHours: number;
  remainingWeeklyQuota: number;
  maxWeeklyHours: number;
  role: string;
  department: string;
  policyName: string;
  message?: string;
}

// ----------------------------------------------------
// R6: Booking Lifecycle, Rescheduling, Extension & My Bookings Contracts
// ----------------------------------------------------

export type BookingLifecycleAction = 'RESCHEDULE' | 'CANCEL' | 'EXTEND' | 'END_EARLY' | 'SHOW_QR';

export type MyBookingsTab = 'UPCOMING' | 'PENDING' | 'PAST' | 'CANCELLED';

export interface BookingActionEligibility {
  canReschedule: boolean;
  canCancel: boolean;
  canExtend: boolean;
  canEndEarly: boolean;
  canShowQr: boolean;
  cancellationCutoffPassed: boolean;
  cancellationCutoffMinutes: number;
  reason?: string;
}

export interface MyBookingsQuery {
  tab?: MyBookingsTab;
  page?: number;
  limit?: number;
  sortBy?: 'startTime' | 'createdAt' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface BookingListItemDTO extends BookingDTO {
  actualEndTime?: string | null;
  eligibility: BookingActionEligibility;
  series?: {
    id: string;
    frequency: string;
    totalCount?: number | null;
  } | null;
}

export interface MyBookingsResponse {
  bookings: BookingListItemDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
  tabCounts: {
    upcoming: number;
    pending: number;
    past: number;
    cancelled: number;
  };
}

export interface RescheduleBookingRequest {
  resourceId?: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  purpose?: string;
  expectedAttendance?: number;
  activityType?: ActivityType;
}

export interface RescheduleBookingResponse {
  booking: BookingListItemDTO;
  previousSchedule: {
    startTime: string;
    endTime: string;
    status: BookingStatus;
  };
  newSchedule: {
    startTime: string;
    endTime: string;
    status: BookingStatus;
  };
  requiresApproval: boolean;
  message: string;
}

export interface CancelBookingRequest {
  reason: string;
  scope?: OccurrenceCancellationScope;
}

export interface CancelBookingResponse {
  booking: BookingListItemDTO;
  cancellationReason: string;
  cancelledAt: string;
  message: string;
  seriesCancellation?: SeriesCancellationResponse;
}

export interface EndEarlyBookingResponse {
  booking: BookingListItemDTO;
  scheduledEndTime: string;
  actualEndTime: string;
  freedMinutes: number;
  message: string;
}

export interface ExtendBookingRequest {
  durationMinutes: number;
}

export interface ExtendBookingResponse {
  booking: BookingListItemDTO;
  previousEndTime: string;
  newEndTime: string;
  extendedMinutes: number;
  message: string;
}

export interface AutomaticCompletionJobResponse {
  processed: number;
  completed: number;
  skipped: number;
  failed: number;
  errors?: { id: string; error: string }[];
  message: string;
}

export interface LifecycleErrorResponse {
  error: string;
  details?: any;
  alternativeSlots?: AlternativeSlot[];
}
