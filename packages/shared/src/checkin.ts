export type CheckInMethod =
  | 'QR_TOKEN'
  | 'PIN'
  | 'APPROVER_OVERRIDE'
  | 'ADMIN_OVERRIDE';

export type CheckInErrorCode =
  | 'PENDING_BOOKING'
  | 'BOOKING_NOT_CONFIRMED'
  | 'WRONG_USER'
  | 'CHECK_IN_TOO_EARLY'
  | 'CHECK_IN_TOO_LATE'
  | 'BOOKING_ALREADY_CHECKED_IN'
  | 'BOOKING_ALREADY_ENDED'
  | 'INVALID_BOOKING_TOKEN'
  | 'EXPIRED_BOOKING_TOKEN'
  | 'REPLAYED_BOOKING_TOKEN'
  | 'INVALID_PIN'
  | 'PIN_LOCKED'
  | 'INVALID_VENUE_QR'
  | 'VENUE_MISMATCH'
  | 'OVERRIDE_REASON_REQUIRED'
  | 'RATE_LIMITED';

export interface CheckInTokenResponse {
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
  bookingId: string;
  resourceId: string;
  qrPayload: string;
}

export interface CheckInOverrideInput {
  reason: string;
  bypassLateWindow?: boolean;
  bypassVenueVerification?: boolean;
}

export interface CheckInRequest {
  bookingToken?: string;
  pin?: string;
  venueQr?: string;
  override?: CheckInOverrideInput;
}

export interface PinLockoutResponse {
  locked: boolean;
  failedAttempts: number;
  remainingAttempts: number;
  lockedUntil?: string | null;
  retryAfterSeconds?: number;
}

export interface CheckInSuccessResponse {
  success: true;
  message: string;
  checkedInAt: string;
  checkInMethod: CheckInMethod;
  checkedInById: string;
  venueVerified: boolean;
  overrideReason?: string | null;
  booking: any;
}

export interface CheckInErrorResponse {
  error: string;
  code: CheckInErrorCode;
  retryAfterSeconds?: number;
  lockedUntil?: string | null;
  remainingAttempts?: number;
  availableFrom?: string;
  releaseDeadline?: string;
  canOverride?: boolean;
}

export interface ResourceRoomQrDTO {
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  building: string;
  floor?: string | null;
  department: string;
  secretVersion: number;
  rotatedAt?: string | null;
  qrPayload: string;
}

export interface RotateResourceQrResponse {
  roomQr: ResourceRoomQrDTO;
  message: string;
}
