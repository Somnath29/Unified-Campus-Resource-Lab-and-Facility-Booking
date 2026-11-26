import { BookingStatus } from './index';

export const ALLOWED_BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING: ['APPROVED', 'CONFIRMED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'NO_SHOW', 'CANCELLED'],
  CHECKED_IN: ['COMPLETED'],
  REJECTED: [],
  CANCELLED: [],
  NO_SHOW: [],
  COMPLETED: [],
};

export class InvalidStateTransitionError extends Error {
  readonly from: BookingStatus;
  readonly to: BookingStatus;

  constructor(from: BookingStatus, to: BookingStatus) {
    super(`Invalid booking status transition from ${from} to ${to}.`);
    this.name = 'InvalidStateTransitionError';
    this.from = from;
    this.to = to;
    Object.setPrototypeOf(this, InvalidStateTransitionError.prototype);
  }
}

/**
 * Checks whether a transition between two booking statuses is permitted.
 */
export function isValidBookingTransition(from: BookingStatus, to: BookingStatus): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_BOOKING_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Validates a transition between two booking statuses and throws if invalid.
 */
export function validateBookingTransition(from: BookingStatus, to: BookingStatus): void {
  if (!isValidBookingTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

/**
 * Checks if a booking with the given status can be cancelled.
 */
export function canCancelBooking(status: BookingStatus): boolean {
  return isValidBookingTransition(status, 'CANCELLED');
}
