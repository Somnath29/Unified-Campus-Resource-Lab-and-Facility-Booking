// User Roles
export type UserRole = 'STUDENT' | 'FACULTY' | 'DEPARTMENT_APPROVER' | 'ADMINISTRATOR';

// Resource Categories
export type ResourceCategory = 
  | 'CLASSROOM' 
  | 'LAB' 
  | 'SEMINAR_HALL' 
  | 'MEETING_ROOM' 
  | 'SPORTS' 
  | 'EQUIPMENT' 
  | 'VEHICLE';

// Booking Statuses
export type BookingStatus = 
  | 'PENDING' 
  | 'APPROVED' 
  | 'CONFIRMED' 
  | 'REJECTED' 
  | 'CANCELLED' 
  | 'CHECKED_IN' 
  | 'NO_SHOW' 
  | 'COMPLETED';

// Activity Types
export type ActivityType = 
  | 'CLASS_LECTURE' 
  | 'LAB_SESSION' 
  | 'CLUB_EVENT' 
  | 'PROJECT_WORK' 
  | 'FACULTY_MEETING' 
  | 'EXAM_EVALUATION' 
  | 'SPORTS_PRACTICE' 
  | 'GUEST_SEMINAR';

// Priority Levels
export type PriorityLevel = 'NORMAL' | 'HIGH' | 'URGENT';

// User Interface
export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  regNo?: string | null;
  department: string;
  designation?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  createdAt: string;
}

// Resource Interface
export interface ResourceDTO {
  id: string;
  code: string;
  name: string;
  category: ResourceCategory;
  department: string;
  building: string;
  floor?: string | null;
  capacity: number;
  amenities: string[];
  imageUrl: string;
  requiresApproval: boolean;
  isAvailableNow: boolean;
  isUnderMaintenance: boolean;
  maintenanceReason?: string | null;
  operatingHours: string;
  createdAt: string;
}

// Booking Interface
export interface BookingDTO {
  id: string;
  bookingNumber: string;
  userId: string;
  user?: UserDTO;
  resourceId: string;
  resource?: ResourceDTO;
  startTime: string; // ISO
  endTime: string;   // ISO
  purpose: string;
  activityType: ActivityType;
  expectedAttendance: number;
  priority: PriorityLevel;
  status: BookingStatus;
  checkInToken?: string | null;
  checkedInAt?: string | null;
  releaseDeadline?: string | null;
  approvalNotes?: string | null;
  rejectionReason?: string | null;
  departmentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Timetable Entry Interface
export interface TimetableEntryDTO {
  id: string;
  resourceId: string;
  courseCode: string;
  courseName: string;
  instructorName: string;
  dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
  startTime: string; // "10:00"
  endTime: string;   // "11:50"
  department: string;
  semester: string;
  section: string;
}

// Notification Interface
export interface NotificationDTO {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'BOOKING' | 'APPROVAL' | 'REMINDER' | 'CHECKIN' | 'SYSTEM';
  read: boolean;
  link?: string | null;
  createdAt: string;
}

// Department Policy Interface
export interface DepartmentPolicyDTO {
  id: string;
  department: string;
  maxAdvanceDays: number;
  maxBookingHoursPerWeek: number;
  requireFacultyEndorsement: boolean;
  autoReleaseMinutes: number;
  autoApproveStudentHours: number; // e.g. bookings under 2 hrs auto approve if score is good
  blackoutPeriods?: string | null;
}

// Auth Response
export interface AuthResponse {
  token: string;
  user: UserDTO;
}

// Stats & Analytics Data Types
export interface DashboardStatsDTO {
  upcomingBookingsCount: number;
  pendingRequestsCount: number;
  availableResourcesCount: number;
  clubBookingsCount: number;
  nextBooking?: BookingDTO | null;
}

export interface AdminAnalyticsDTO {
  totalBookings: number;
  utilizationRate: number;
  noShowRate: number;
  activeUsers: number;
  categoryDistribution: { category: string; count: number; hours: number }[];
  hourlyOccupancy: { hour: string; weekday: number; weekend: number }[];
  weeklyTrends: { day: string; bookings: number; checkIns: number; noShows: number }[];
  departmentBreakdown: { department: string; bookings: number; utilization: number }[];
  topResources: { name: string; category: string; bookingsCount: number; utilization: number }[];
}

