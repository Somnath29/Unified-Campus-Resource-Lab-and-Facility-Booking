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
