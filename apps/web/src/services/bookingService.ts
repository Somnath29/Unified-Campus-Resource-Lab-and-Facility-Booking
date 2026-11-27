import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { BookingStatus, ActivityType, PriorityLevel, Role, Prisma } from '@prisma/client';
import { ApiError } from '@/lib/auth';
export { ApiError };
import env from '@/config/env';
import { generateSecurePin, hashPin } from '@/lib/checkin-crypto';
import {
  validateOperatingHours,
  getDayOfWeekInKolkata,
  getTimeStringInKolkata,
  getDateStringInKolkata,
  kolkataToUtc,
  addDaysKolkata,
} from '@/lib/timezone';
import { evaluateBookingPolicy } from './policyService';
import {
  validateBookingTransition,
  canCancelBooking,
  MyBookingsQuery,
  MyBookingsResponse,
  MyBookingsTab,
  BookingListItemDTO,
  BookingActionEligibility,
  RescheduleBookingRequest,
  RescheduleBookingResponse,
  EndEarlyBookingResponse,
  ExtendBookingResponse,
  AutomaticCompletionJobResponse,
  AlternativeSlot,
} from '@lpu/shared';

export interface CreateBookingInput {
  resourceId: string;
  startTime: string;
  endTime: string;
  purpose: string;
  activityType?: ActivityType;
  expectedAttendance?: number;
  priority?: PriorityLevel;
}

export interface BookingUserContext {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: string;
}

export interface CreateBookingOptions {
  user: BookingUserContext;
  input: CreateBookingInput;
  idempotencyKey?: string | null;
  tx?: Prisma.TransactionClient;
  waitlistEntryId?: string | null;
}

export interface CreateBookingResult {
  booking: any;
  message: string;
  isIdempotentReplay?: boolean;
}

/**
 * Computes a deterministic SHA-256 fingerprint for the booking request payload.
 */
export function computeRequestHash(input: CreateBookingInput): string {
  const normalized = {
    resourceId: input.resourceId,
    startTime: new Date(input.startTime).toISOString(),
    endTime: new Date(input.endTime).toISOString(),
    purpose: input.purpose.trim(),
    activityType: input.activityType || ActivityType.PROJECT_WORK,
    expectedAttendance: input.expectedAttendance || 1,
    priority: input.priority || PriorityLevel.NORMAL,
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Generates a cryptographically secure, unique 6-digit check-in PIN.
 */
export async function generateUniqueCheckInPin(tx: Prisma.TransactionClient): Promise<string> {
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    attempts++;
    const pin = crypto.randomInt(100000, 1000000).toString();
    const existing = await tx.booking.findUnique({
      where: { checkInToken: pin },
      select: { id: true },
    });
    if (!existing) {
      return pin;
    }
  }

  // Fallback: 6-digit random token
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Fetches the next sequential booking number from PostgreSQL sequence booking_number_seq.
 */
export async function getNextBookingNumber(tx: Prisma.TransactionClient): Promise<string> {
  const currentYear = new Date().getFullYear();
  try {
    const seqResult = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('booking_number_seq')::bigint as nextval`;
    const seqNum = String(seqResult[0]?.nextval || 1000).padStart(6, '0');
    return `LPU-${currentYear}-${seqNum}`;
  } catch {
    const count = await tx.booking.count();
    const seqNum = String(count + 1001).padStart(6, '0');
    return `LPU-${currentYear}-${seqNum}`;
  }
}

/**
 * Searches for up to 3 genuine available alternative time slots on the same resource.
 */
export async function findAlternativeSlots(
  resourceId: string,
  targetDate: string,
  durationMinutes: number,
  operatingHours: string,
  excludeBookingId?: string
): Promise<AlternativeSlot[]> {
  const alternatives: AlternativeSlot[] = [];
  const datesToInspect = [targetDate, addDaysKolkata(targetDate, 1)];

  // Candidate start times to probe
  const candidateStarts = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

  for (const dateStr of datesToInspect) {
    if (alternatives.length >= 3) break;

    const dayOfWeek = getDayOfWeekInKolkata(kolkataToUtc(dateStr, '12:00'));

    for (const startHHMM of candidateStarts) {
      if (alternatives.length >= 3) break;

      const [sH, sM] = startHHMM.split(':').map(Number);
      const totalStartMin = sH * 60 + sM;
      const totalEndMin = totalStartMin + durationMinutes;

      const eH = Math.floor(totalEndMin / 60);
      const eM = totalEndMin % 60;
      if (eH >= 24) continue;

      const endHHMM = `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}`;

      const candStartUtc = kolkataToUtc(dateStr, startHHMM);
      const candEndUtc = kolkataToUtc(dateStr, endHHMM);

      // Check operating hours
      const opCheck = validateOperatingHours(candStartUtc, candEndUtc, operatingHours);
      if (!opCheck.valid) continue;

      // Check timetable conflict
      const timetableClash = await prisma.timetableEntry.findFirst({
        where: {
          resourceId,
          dayOfWeek,
          AND: [
            { startTime: { lt: endHHMM } },
            { endTime: { gt: startHHMM } },
          ],
        },
      });
      if (timetableClash) continue;

      // Check existing booking conflict
      const clashWhere: Prisma.BookingWhereInput = {
        resourceId,
        status: {
          in: [
            BookingStatus.PENDING,
            BookingStatus.APPROVED,
            BookingStatus.CONFIRMED,
            BookingStatus.CHECKED_IN,
          ],
        },
        AND: [
          { startTime: { lt: candEndUtc } },
          { endTime: { gt: candStartUtc } },
        ],
      };
      if (excludeBookingId) {
        clashWhere.id = { not: excludeBookingId };
      }

      const bookingClash = await prisma.booking.findFirst({ where: clashWhere });
      if (bookingClash) continue;

      alternatives.push({
        date: dateStr,
        startTime: startHHMM,
        endTime: endHHMM,
        durationMinutes,
      });
    }
  }

  return alternatives;
}

/**
 * Centralized Booking Service owning all booking business logic, validations,
 * transaction execution, idempotency, and PostgreSQL exclusion constraint handling.
 */
export class BookingService {
  /**
   * Creates a new campus resource booking with full policy evaluation,
   * timetable conflict checks, idempotency, and double-booking concurrency safety.
   */
  static async createBooking(options: CreateBookingOptions): Promise<CreateBookingResult> {
    const { user, input, idempotencyKey, tx: externalTx, waitlistEntryId } = options;
    // Reuse caller's transaction client when invoked inside an outer $transaction
    // (e.g. WaitlistService.acceptOffer) so we never acquire a second pool connection.
    const db = externalTx ?? prisma;
    const start = new Date(input.startTime);
    const end = new Date(input.endTime);

    // 1. Basic Duration & Time Range Validations
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new ApiError(400, 'Invalid start or end time format.');
    }

    if (end <= start) {
      throw new ApiError(400, 'End time must be strictly after start time.');
    }

    const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    if (durationMinutes < 15) {
      throw new ApiError(400, 'Minimum booking duration is 15 minutes.');
    }

    const durationHours = durationMinutes / 60;
    if (durationHours > 8) {
      throw new ApiError(400, 'Maximum single booking duration is 8 hours.');
    }

    // 2. Idempotency Check (if key provided)
    const requestHash = computeRequestHash(input);

    if (idempotencyKey) {
      const existingKeyRecord = await db.idempotencyKey.findUnique({
        where: {
          userId_key: {
            userId: user.id,
            key: idempotencyKey,
          },
        },
      });

      if (existingKeyRecord) {
        if (existingKeyRecord.requestHash !== requestHash) {
          throw new ApiError(
            409,
            'Idempotency conflict: The provided Idempotency-Key has already been used with different request parameters.'
          );
        }

        const cachedResponse = JSON.parse(existingKeyRecord.responseBody);
        return {
          booking: cachedResponse.booking,
          message: cachedResponse.message || 'Booking retrieved via idempotency key.',
          isIdempotentReplay: true,
        };
      }
    }

    // 3. Resource Validations
    const resource = await db.resource.findUnique({
      where: { id: input.resourceId },
    });

    if (!resource || resource.deletedAt !== null) {
      throw new ApiError(404, 'Selected resource does not exist or has been archived.');
    }

    if (resource.isUnderMaintenance) {
      throw new ApiError(
        400,
        `Resource is temporarily blocked for maintenance: ${resource.maintenanceReason || 'Scheduled upkeep'}.`
      );
    }

    const expectedAttendance = input.expectedAttendance || 1;
    if (expectedAttendance <= 0) {
      throw new ApiError(400, 'Expected attendance must be at least 1 person.');
    }

    if (expectedAttendance > resource.capacity) {
      throw new ApiError(
        400,
        `Expected attendance (${expectedAttendance}) exceeds maximum capacity of ${resource.capacity}.`
      );
    }

    // 4. Operating Hours Validation (Asia/Kolkata timezone)
    const opCheck = validateOperatingHours(start, end, resource.operatingHours);
    if (!opCheck.valid) {
      throw new ApiError(400, opCheck.reason || 'Requested slot is outside facility operating hours.');
    }

    // 5. Timetable Conflict Validation (Asia/Kolkata day and time)
    const dayOfWeek = getDayOfWeekInKolkata(start);
    const startHourMin = getTimeStringInKolkata(start);
    const endHourMin = getTimeStringInKolkata(end);

    const timetableConflicts = await db.timetableEntry.findMany({
      where: {
        resourceId: input.resourceId,
        dayOfWeek,
        AND: [
          { startTime: { lt: endHourMin } },
          { endTime: { gt: startHourMin } },
        ],
      },
    });

    if (timetableConflicts.length > 0) {
      const cls = timetableConflicts[0];
      throw new ApiError(
        409,
        `Academic Timetable Conflict: ${cls.courseCode} - ${cls.courseName} is scheduled in this room on this day (${cls.startTime} - ${cls.endTime}).`,
        { timetableConflict: cls }
      );
    }

    // 6. Policy Engine Evaluation (A7)
    const policyDecision = await evaluateBookingPolicy({
      user,
      resource,
      startTime: start,
      endTime: end,
      prisma: db as any,
    });

    if (!policyDecision.allowed) {
      throw new ApiError(422, policyDecision.reason || 'Booking rejected by department policy.');
    }

    const initialStatus = policyDecision.initialStatus;
    const releaseDeadline = new Date(start.getTime() + policyDecision.autoReleaseMinutes * 60000);

    // 7. Atomic Database Transaction with Exclusion Constraint Handling
    try {
      const txFn = async (tx: Prisma.TransactionClient) => {
        // Double-check application-level overlapping bookings inside transaction
        const overlapping = await tx.booking.findFirst({
          where: {
            resourceId: input.resourceId,
            status: {
              in: [
                BookingStatus.PENDING,
                BookingStatus.APPROVED,
                BookingStatus.CONFIRMED,
                BookingStatus.CHECKED_IN,
              ],
            },
            AND: [
              { startTime: { lt: end } },
              { endTime: { gt: start } },
            ],
          },
        });

        if (overlapping) {
          if (idempotencyKey) {
            const existingKey = await tx.idempotencyKey.findUnique({
              where: {
                userId_key: {
                  userId: user.id,
                  key: idempotencyKey,
                },
              },
            });
            if (existingKey) {
              const cached = JSON.parse(existingKey.responseBody);
              return {
                booking: cached.booking,
                message: cached.message,
                isIdempotentReplay: true,
              };
            }
          }

          throw new ApiError(
            409,
            `Slot conflict: The selected resource is already booked or reserved during this time window. (Conflicting slot: ${overlapping.startTime.toISOString()} to ${overlapping.endTime.toISOString()})`,
            { conflictingBookingId: overlapping.id }
          );
        }

        // Generate sequential booking number & 6-digit cryptographically secure PIN
        const bookingNumber = await getNextBookingNumber(tx);
        const checkInToken = await generateUniqueCheckInPin(tx);

        const newBooking = await tx.booking.create({
          data: {
            bookingNumber,
            userId: user.id,
            resourceId: input.resourceId,
            startTime: start,
            endTime: end,
            purpose: input.purpose.trim(),
            activityType: input.activityType || ActivityType.PROJECT_WORK,
            expectedAttendance,
            priority: input.priority || PriorityLevel.NORMAL,
            status: initialStatus,
            checkInToken: null,
            checkInPinHash: hashPin(checkInToken),
            releaseDeadline,
            departmentId: resource.department,
          },
          include: {
            resource: true,
          },
        });

        // Fulfill waitlist entry atomically if linked
        if (waitlistEntryId) {
          await tx.waitlistEntry.update({
            where: { id: waitlistEntryId },
            data: {
              status: 'FULFILLED',
              bookingId: newBooking.id,
            },
          });
        }

        // Record Audit Log inside the transaction
        await tx.auditLog.create({
          data: {
            action: 'BOOKING_CREATED',
            userId: user.id,
            entityType: 'Booking',
            entityId: newBooking.id,
            details: JSON.stringify({
              bookingNumber: newBooking.bookingNumber,
              status: newBooking.status,
              startTime: newBooking.startTime,
              endTime: newBooking.endTime,
            }),
          },
        });

        const { checkInPinHash: _omitPinHash, ...safeBooking } = newBooking;
        const responsePayload = {
          booking: {
            ...safeBooking,
            checkInToken, // Returned once on creation; never stored in plaintext in DB
          },
          message:
            initialStatus === BookingStatus.CONFIRMED
              ? 'Booking successfully confirmed!'
              : 'Booking request submitted for department approval.',
        };

        // Persist Idempotency Record atomically inside the same transaction
        if (idempotencyKey) {
          await tx.idempotencyKey.create({
            data: {
              key: idempotencyKey,
              userId: user.id,
              requestHash,
              statusCode: 201,
              responseBody: JSON.stringify(responsePayload),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
            },
          });
        }

        return responsePayload;
      };

      const result = externalTx
        ? await txFn(externalTx)
        : await prisma.$transaction(txFn, {
            maxWait: 15000,
            timeout: 30000,
          });

      // 8. Notifications (outside critical transaction path)
      try {
        await prisma.notification.create({
          data: {
            userId: user.id,
            title:
              initialStatus === BookingStatus.CONFIRMED
                ? `Booking Confirmed: ${resource.name}`
                : `Booking Request Submitted: ${resource.name}`,
            message:
              initialStatus === BookingStatus.CONFIRMED
                ? `Your booking #${result.booking.bookingNumber} is confirmed for ${start.toLocaleDateString()}.`
                : `Your request #${result.booking.bookingNumber} has been forwarded to the department approver for review.`,
            type: 'BOOKING',
            link: '/my-bookings',
          },
        });

        if (initialStatus === BookingStatus.PENDING) {
          const approvers = await prisma.user.findMany({
            where: {
              role: { in: [Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR] },
              department: resource.department,
            },
          });

          for (const approver of approvers) {
            await prisma.notification.create({
              data: {
                userId: approver.id,
                title: `New Booking Request: ${resource.name}`,
                message: `${user.name} requested ${resource.name} for "${input.purpose.trim()}" on ${start.toLocaleDateString()}.`,
                type: 'APPROVAL',
                link: '/approvals',
              },
            });
          }
        }
      } catch {
        // Notification failure should not roll back successful booking
      }

      return result;
    } catch (err: any) {
      // Check if a concurrent request with the same idempotency key already succeeded or is committing
      if (idempotencyKey) {
        try {
          for (let retry = 0; retry < 6; retry++) {
            const existing = await prisma.idempotencyKey.findUnique({
              where: {
                userId_key: {
                  userId: user.id,
                  key: idempotencyKey,
                },
              },
            });
            if (existing) {
              const cached = JSON.parse(existing.responseBody);
              return {
                booking: cached.booking,
                message: cached.message,
                isIdempotentReplay: true,
              };
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        } catch {}
      }

      // Handle PostgreSQL GiST exclusion constraint error code 23P01 or deadlock 40P01
      const msg = String(err?.message || '');
      if (
        err?.code === '23P01' ||
        err?.code === '40P01' ||
        msg.includes('23P01') ||
        msg.includes('40P01') ||
        msg.includes('deadlock detected') ||
        msg.includes('no_overlapping_bookings') ||
        msg.includes('conflicting key value violates exclusion constraint')
      ) {
        throw new ApiError(
          409,
          'Slot conflict: The selected resource is already booked or reserved during this time window.'
        );
      }

      // Handle IdempotencyKey unique constraint race condition (P2002)
      if (err?.code === 'P2002' && err?.meta?.target?.includes('key')) {
        if (idempotencyKey) {
          const existing = await prisma.idempotencyKey.findUnique({
            where: {
              userId_key: {
                userId: user.id,
                key: idempotencyKey,
              },
            },
          });
          if (existing) {
            const cached = JSON.parse(existing.responseBody);
            return {
              booking: cached.booking,
              message: cached.message,
              isIdempotentReplay: true,
            };
          }
        }
      }

      throw err;
    }
  }

  /**
   * Retrieves a single booking by ID with strict ownership and role authorization checks.
   */
  static async getBookingById(id: string, user: BookingUserContext) {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        resource: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            regNo: true,
            department: true,
            phone: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found.');
    }

    // Authorization checks:
    // 1. Owner can always view
    const isOwner = booking.userId === user.id;

    // 2. Administrator can view all
    const isAdmin = user.role === Role.ADMINISTRATOR;

    // 3. Department Approver can only view bookings within their department
    const isDeptApprover =
      user.role === Role.DEPARTMENT_APPROVER &&
      (user.department === booking.departmentId || user.department === booking.resource.department);

    if (!isOwner && !isAdmin && !isDeptApprover) {
      throw new ApiError(403, 'Unauthorized to view this booking.');
    }

    return booking;
  }

  /**
   * Computes action eligibility for a booking based on status, timestamps, and roles.
   */
  static computeBookingEligibility(
    booking: {
      status: BookingStatus;
      startTime: Date;
      endTime: Date;
      userId: string;
      checkInToken?: string | null;
    },
    user: BookingUserContext
  ): BookingActionEligibility {
    const isOwner = booking.userId === user.id;
    const isAdmin = user.role === Role.ADMINISTRATOR;
    const isDeptApprover = user.role === Role.DEPARTMENT_APPROVER;

    const cutoffMinutes = env.CANCELLATION_CUTOFF_MINUTES ?? 60;
    const now = new Date();
    const cutoffTime = new Date(booking.startTime.getTime() - cutoffMinutes * 60 * 1000);
    const cancellationCutoffPassed = now >= cutoffTime;

    const isPendingOrConfirmed =
      booking.status === BookingStatus.PENDING ||
      booking.status === BookingStatus.APPROVED ||
      booking.status === BookingStatus.CONFIRMED;

    // Reschedule: only before check-in, owner or admin/approver
    const canReschedule = isPendingOrConfirmed && (isOwner || isAdmin || isDeptApprover);

    // Cancel:
    // 1. Must be cancellable by state machine (PENDING, APPROVED, CONFIRMED)
    // 2. If cutoff passed: only admin/approver can cancel
    // 3. Otherwise: owner can cancel
    let canCancel = false;
    let cancelReasonMsg: string | undefined;

    if (canCancelBooking(booking.status)) {
      if (isAdmin || isDeptApprover) {
        canCancel = true;
      } else if (isOwner) {
        if (cancellationCutoffPassed) {
          canCancel = false;
          cancelReasonMsg = `Cancellation cutoff passed (${cutoffMinutes}m before start). Contact department approver.`;
        } else {
          canCancel = true;
        }
      }
    } else {
      cancelReasonMsg = `Status ${booking.status} is non-cancellable.`;
    }

    // Extend & End Early: only when CHECKED_IN, owner or admin
    const canExtend = booking.status === BookingStatus.CHECKED_IN && (isOwner || isAdmin);
    const canEndEarly = booking.status === BookingStatus.CHECKED_IN && (isOwner || isAdmin);

    // Show QR: CONFIRMED or CHECKED_IN, owner or admin
    const canShowQr =
      (booking.status === BookingStatus.CONFIRMED || booking.status === BookingStatus.CHECKED_IN) &&
      (isOwner || isAdmin);

    return {
      canReschedule,
      canCancel,
      canExtend,
      canEndEarly,
      canShowQr,
      cancellationCutoffPassed,
      cancellationCutoffMinutes: cutoffMinutes,
      reason: cancelReasonMsg,
    };
  }

  /**
   * Cancels an eligible booking, enforcing state machine transitions,
   * configurable cutoff, permissions, notifications, and audit logging.
   */
  static async cancelBooking(id: string, user: BookingUserContext, reason?: string) {
    if (reason !== undefined && !reason.trim()) {
      throw new ApiError(400, 'A non-empty cancellation reason is required.');
    }
    const cleanReason = (reason && reason.trim()) || (user.name ? `Cancelled by ${user.name}` : 'Cancelled by requester');
    if (cleanReason.length > 500) {
      throw new ApiError(400, 'Cancellation reason exceeds maximum length of 500 characters.');
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        resource: true,
        series: { select: { id: true, frequency: true, count: true } },
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found.');
    }

    // Authorization checks
    const isOwner = booking.userId === user.id;
    const isAdmin = user.role === Role.ADMINISTRATOR;
    const isDeptApprover =
      user.role === Role.DEPARTMENT_APPROVER &&
      (user.department === booking.departmentId || user.department === booking.resource.department);

    if (!isOwner && !isAdmin && !isDeptApprover) {
      throw new ApiError(403, 'Unauthorized to cancel this booking.');
    }

    // State Machine Validation:
    if (booking.status === BookingStatus.CANCELLED) {
      throw new ApiError(400, 'Booking has already been cancelled.');
    }

    // COMPLETED, CHECKED_IN, NO_SHOW cannot be cancelled -> 409 Conflict!
    if (!canCancelBooking(booking.status)) {
      throw new ApiError(
        409,
        `Cannot cancel booking with current status: ${booking.status}. Only PENDING, APPROVED, or CONFIRMED bookings may be cancelled.`
      );
    }

    // Cancellation Cutoff check for requester/owner (Admin & Approver can cancel after cutoff)
    const cutoffMinutes = env.CANCELLATION_CUTOFF_MINUTES ?? 60;
    const now = new Date();
    const cutoffTime = new Date(booking.startTime.getTime() - cutoffMinutes * 60 * 1000);

    if (now >= cutoffTime && isOwner && !isAdmin && !isDeptApprover) {
      throw new ApiError(
        403,
        `Cancellation window closed: Bookings cannot be cancelled by requesters less than ${cutoffMinutes} minutes prior to scheduled start time. Please contact a department approver or administrator.`
      );
    }

    validateBookingTransition(booking.status, BookingStatus.CANCELLED);

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id },
        data: {
          status: BookingStatus.CANCELLED,
          rejectionReason: cleanReason,
        },
        include: {
          resource: true,
          series: { select: { id: true, frequency: true, count: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'BOOKING_CANCELLED',
          userId: user.id,
          entityType: 'Booking',
          entityId: id,
          details: JSON.stringify({
            bookingNumber: b.bookingNumber,
            cancelledBy: user.email,
            role: user.role,
            reason: cleanReason,
            cutoffMinutes,
          }),
        },
      });

      return b;
    });

    // Notify user & dispatch event email
    try {
      await prisma.notification.create({
        data: {
          userId: booking.userId,
          title: `Booking Cancelled: ${booking.resource.name}`,
          message: `Booking #${booking.bookingNumber} was cancelled. Reason: ${cleanReason}`,
          type: 'BOOKING',
          link: '/my-bookings?tab=CANCELLED',
        },
      });
      const owner = await prisma.user.findUnique({
        where: { id: booking.userId },
        select: { id: true, email: true, name: true },
      });
      if (owner) {
        const { dispatchEventEmail } = await import('@/services/reminderService');
        await dispatchEventEmail({
          userId: owner.id,
          userEmail: owner.email,
          userName: owner.name,
          bookingId: booking.id,
          notificationType: 'BOOKING_CANCELLED',
          templateKind: 'booking_cancelled',
          scheduledFor: new Date(),
          resourceName: booking.resource.name,
          building: booking.resource.building,
          bookingNumber: booking.bookingNumber,
          startTime: booking.startTime,
          endTime: booking.endTime,
          reason: cleanReason,
          actionPath: '/my-bookings?tab=CANCELLED',
        });
      }
    } catch {
      // Non-fatal
    }

    // Automatically trigger waitlist offer for the released slot
    try {
      const { WaitlistService } = await import('@/services/waitlistService');
      await WaitlistService.triggerSlotOffer({
        resourceId: booking.resourceId,
        startTime: booking.startTime,
        endTime: booking.endTime,
      });
    } catch (err) {
      console.error('[Waitlist trigger error on cancelBooking]', err);
    }

    return updated;
  }

  /**
   * Reschedules an eligible booking to a new time or resource.
   */
  static async rescheduleBooking({
    id,
    user,
    input,
  }: {
    id: string;
    user: BookingUserContext;
    input: RescheduleBookingRequest;
  }): Promise<RescheduleBookingResponse> {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        resource: true,
        series: { select: { id: true, frequency: true, count: true } },
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found.');
    }

    // 1. Authorization Check
    const isOwner = booking.userId === user.id;
    const isAdmin = user.role === Role.ADMINISTRATOR;
    const isDeptApprover =
      user.role === Role.DEPARTMENT_APPROVER &&
      (user.department === booking.departmentId || user.department === booking.resource.department);

    if (!isOwner && !isAdmin && !isDeptApprover) {
      throw new ApiError(403, 'Unauthorized to reschedule this booking.');
    }

    // 2. State Machine Eligibility Check
    const allowedStatuses: BookingStatus[] = [
      BookingStatus.PENDING,
      BookingStatus.APPROVED,
      BookingStatus.CONFIRMED,
    ];

    if (!allowedStatuses.includes(booking.status)) {
      throw new ApiError(
        409,
        `Cannot reschedule booking with status ${booking.status}. Only PENDING, APPROVED, or CONFIRMED bookings may be rescheduled.`
      );
    }

    // 3. Time Validation
    const newStart = new Date(input.startTime);
    const newEnd = new Date(input.endTime);

    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
      throw new ApiError(400, 'Invalid start or end time format.');
    }

    if (newEnd <= newStart) {
      throw new ApiError(400, 'End time must be strictly after start time.');
    }

    const durationMinutes = (newEnd.getTime() - newStart.getTime()) / (1000 * 60);
    if (durationMinutes < 15) {
      throw new ApiError(400, 'Minimum booking duration is 15 minutes.');
    }

    if (durationMinutes / 60 > 8) {
      throw new ApiError(400, 'Maximum single booking duration is 8 hours.');
    }

    // 4. Resource Check
    const targetResourceId = input.resourceId || booking.resourceId;
    const targetResource = await prisma.resource.findUnique({
      where: { id: targetResourceId },
    });

    if (!targetResource || targetResource.deletedAt !== null) {
      throw new ApiError(404, 'Selected resource does not exist or has been archived.');
    }

    if (targetResource.isUnderMaintenance) {
      throw new ApiError(
        400,
        `Resource is currently under maintenance: ${targetResource.maintenanceReason || 'Scheduled upkeep'}.`
      );
    }

    const attendance = input.expectedAttendance || booking.expectedAttendance;
    if (attendance > targetResource.capacity) {
      throw new ApiError(
        400,
        `Expected attendance (${attendance}) exceeds resource capacity of ${targetResource.capacity}.`
      );
    }

    // 5. Operating Hours
    const opCheck = validateOperatingHours(newStart, newEnd, targetResource.operatingHours);
    if (!opCheck.valid) {
      throw new ApiError(400, opCheck.reason || 'Requested time is outside facility operating hours.');
    }

    // 6. Timetable Clash Check
    const dayOfWeek = getDayOfWeekInKolkata(newStart);
    const startHHMM = getTimeStringInKolkata(newStart);
    const endHHMM = getTimeStringInKolkata(newEnd);

    const timetableClash = await prisma.timetableEntry.findFirst({
      where: {
        resourceId: targetResource.id,
        dayOfWeek,
        AND: [
          { startTime: { lt: endHHMM } },
          { endTime: { gt: startHHMM } },
        ],
      },
    });

    if (timetableClash) {
      const targetDateStr = getDateStringInKolkata(newStart);
      const alternativeSlots = await findAlternativeSlots(
        targetResource.id,
        targetDateStr,
        durationMinutes,
        targetResource.operatingHours,
        booking.id
      );
      throw new ApiError(
        409,
        `Academic timetable conflict: ${timetableClash.courseCode} - ${timetableClash.courseName} (${timetableClash.startTime} - ${timetableClash.endTime}).`,
        { timetableClash, alternativeSlots }
      );
    }

    // 7. Booking Overlap Check (CRITICAL: exclude the booking being rescheduled!)
    const overlap = await prisma.booking.findFirst({
      where: {
        resourceId: targetResource.id,
        id: { not: booking.id },
        status: {
          in: [
            BookingStatus.PENDING,
            BookingStatus.APPROVED,
            BookingStatus.CONFIRMED,
            BookingStatus.CHECKED_IN,
          ],
        },
        AND: [
          { startTime: { lt: newEnd } },
          { endTime: { gt: newStart } },
        ],
      },
    });

    if (overlap) {
      const targetDateStr = getDateStringInKolkata(newStart);
      const alternativeSlots = await findAlternativeSlots(
        targetResource.id,
        targetDateStr,
        durationMinutes,
        targetResource.operatingHours,
        booking.id
      );
      throw new ApiError(
        409,
        'Slot conflict: The selected resource is already booked or reserved during this time window.',
        { conflictingBookingId: overlap.id, alternativeSlots }
      );
    }

    // 8. Policy Evaluation
    const policyDecision = await evaluateBookingPolicy({
      user,
      resource: targetResource,
      startTime: newStart,
      endTime: newEnd,
      prisma,
    });

    if (!policyDecision.allowed) {
      throw new ApiError(400, policyDecision.reason || 'Rescheduling rejected by department policy.');
    }

    const newStatus: BookingStatus = policyDecision.requiresApproval
      ? BookingStatus.PENDING
      : BookingStatus.CONFIRMED;

    // 9. Execute in transaction
    const previousSchedule = {
      startTime: booking.startTime.toISOString(),
      endTime: booking.endTime.toISOString(),
      status: booking.status,
    };

    const updatedBooking = await prisma.$transaction(async (tx) => {
      // Re-verify overlap inside tx
      const txOverlap = await tx.booking.findFirst({
        where: {
          resourceId: targetResource.id,
          id: { not: booking.id },
          status: {
            in: [
              BookingStatus.PENDING,
              BookingStatus.APPROVED,
              BookingStatus.CONFIRMED,
              BookingStatus.CHECKED_IN,
            ],
          },
          AND: [
            { startTime: { lt: newEnd } },
            { endTime: { gt: newStart } },
          ],
        },
      });

      if (txOverlap) {
        throw new ApiError(
          409,
          'Slot conflict: The selected resource was just reserved by another request during this time window.'
        );
      }

      const b = await tx.booking.update({
        where: { id: booking.id },
        data: {
          resourceId: targetResource.id,
          startTime: newStart,
          endTime: newEnd,
          status: newStatus,
          purpose: input.purpose ? input.purpose.trim() : booking.purpose,
          expectedAttendance: attendance,
          activityType: input.activityType || booking.activityType,
          approvalNotes: policyDecision.requiresApproval
            ? (policyDecision.reason || 'Rescheduled booking requires re-approval.')
            : null,
          releaseDeadline: new Date(newStart.getTime() + policyDecision.autoReleaseMinutes * 60000),
        },
        include: {
          resource: true,
          series: { select: { id: true, frequency: true, count: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'BOOKING_RESCHEDULED',
          userId: user.id,
          entityType: 'Booking',
          entityId: booking.id,
          details: JSON.stringify({
            bookingNumber: booking.bookingNumber,
            previousSchedule,
            newSchedule: {
              startTime: newStart.toISOString(),
              endTime: newEnd.toISOString(),
              status: newStatus,
            },
            requiresApproval: policyDecision.requiresApproval,
          }),
        },
      });

      return b;
    });

    // 10. Notify user
    try {
      await prisma.notification.create({
        data: {
          userId: booking.userId,
          title: `Booking Rescheduled: ${targetResource.name}`,
          message: policyDecision.requiresApproval
            ? `Booking #${booking.bookingNumber} was rescheduled and is now pending approver endorsement.`
            : `Booking #${booking.bookingNumber} was successfully rescheduled to ${newStart.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}.`,
          type: 'BOOKING',
          link: '/my-bookings',
        },
      });
    } catch {}

    const eligibility = BookingService.computeBookingEligibility(updatedBooking, user);
    const bookingListItem: BookingListItemDTO = {
      ...updatedBooking,
      startTime: updatedBooking.startTime.toISOString(),
      endTime: updatedBooking.endTime.toISOString(),
      actualEndTime: updatedBooking.actualEndTime ? updatedBooking.actualEndTime.toISOString() : null,
      checkedInAt: updatedBooking.checkedInAt ? updatedBooking.checkedInAt.toISOString() : null,
      releaseDeadline: updatedBooking.releaseDeadline ? updatedBooking.releaseDeadline.toISOString() : null,
      createdAt: updatedBooking.createdAt.toISOString(),
      updatedAt: updatedBooking.updatedAt.toISOString(),
      activityType: updatedBooking.activityType as any,
      priority: updatedBooking.priority as any,
      status: updatedBooking.status as any,
      resource: updatedBooking.resource as any,
      series: updatedBooking.series
        ? {
            id: updatedBooking.series.id,
            frequency: updatedBooking.series.frequency,
            totalCount: updatedBooking.series.count,
          }
        : null,
      eligibility,
    };

    return {
      booking: bookingListItem,
      previousSchedule,
      newSchedule: {
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString(),
        status: newStatus,
      },
      requiresApproval: policyDecision.requiresApproval,
      message: policyDecision.requiresApproval
        ? 'Booking rescheduled successfully and submitted for approver endorsement.'
        : 'Booking rescheduled successfully.',
    };
  }

  /**
   * Ends an active checked-in booking early and records actual completion time.
   */
  static async endBookingEarly(id: string, user: BookingUserContext): Promise<EndEarlyBookingResponse> {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        resource: true,
        series: { select: { id: true, frequency: true, count: true } },
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found.');
    }

    const isOwner = booking.userId === user.id;
    const isAdmin = user.role === Role.ADMINISTRATOR;

    if (!isOwner && !isAdmin) {
      throw new ApiError(403, 'Unauthorized to end this booking early.');
    }

    // State Machine Validation: only CHECKED_IN bookings can be ended early!
    if (booking.status !== BookingStatus.CHECKED_IN) {
      throw new ApiError(
        409,
        `Cannot end booking early. Current status is ${booking.status}; only CHECKED_IN bookings can be ended early.`
      );
    }

    validateBookingTransition(booking.status, BookingStatus.COMPLETED);

    const now = new Date();
    const scheduledEnd = new Date(booking.endTime);
    const freedMinutes = Math.max(0, Math.round((scheduledEnd.getTime() - now.getTime()) / 60000));

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id },
        data: {
          status: BookingStatus.COMPLETED,
          actualEndTime: now,
        },
        include: {
          resource: true,
          series: { select: { id: true, frequency: true, count: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'BOOKING_ENDED_EARLY',
          userId: user.id,
          entityType: 'Booking',
          entityId: id,
          details: JSON.stringify({
            bookingNumber: b.bookingNumber,
            scheduledEndTime: scheduledEnd.toISOString(),
            actualEndTime: now.toISOString(),
            freedMinutes,
          }),
        },
      });

      return b;
    });

    // Notify user
    try {
      await prisma.notification.create({
        data: {
          userId: booking.userId,
          title: `Booking Ended Early: ${booking.resource.name}`,
          message: `Booking #${booking.bookingNumber} was completed early. ${freedMinutes} minutes released.`,
          type: 'BOOKING',
          link: '/my-bookings?tab=PAST',
        },
      });
    } catch {}

    const eligibility = BookingService.computeBookingEligibility(updated, user);
    const bookingListItem: BookingListItemDTO = {
      ...updated,
      startTime: updated.startTime.toISOString(),
      endTime: updated.endTime.toISOString(),
      actualEndTime: updated.actualEndTime ? updated.actualEndTime.toISOString() : null,
      checkedInAt: updated.checkedInAt ? updated.checkedInAt.toISOString() : null,
      releaseDeadline: updated.releaseDeadline ? updated.releaseDeadline.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      activityType: updated.activityType as any,
      priority: updated.priority as any,
      status: updated.status as any,
      resource: updated.resource as any,
      series: updated.series
        ? {
            id: updated.series.id,
            frequency: updated.series.frequency,
            totalCount: updated.series.count,
          }
        : null,
      eligibility,
    };

    return {
      booking: bookingListItem,
      scheduledEndTime: scheduledEnd.toISOString(),
      actualEndTime: now.toISOString(),
      freedMinutes,
      message: `Booking successfully ended early. Released ${freedMinutes} minutes of venue time.`,
    };
  }

  /**
   * Extends an active checked-in booking if the subsequent slot is genuinely available.
   */
  static async extendBooking(
    id: string,
    user: BookingUserContext,
    durationMinutes: number
  ): Promise<ExtendBookingResponse> {
    if (!durationMinutes || durationMinutes <= 0) {
      throw new ApiError(400, 'Extension duration must be a positive number of minutes.');
    }
    if (durationMinutes > 120) {
      throw new ApiError(400, 'Maximum single extension duration is 120 minutes (2 hours).');
    }

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        resource: true,
        series: { select: { id: true, frequency: true, count: true } },
      },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found.');
    }

    const isOwner = booking.userId === user.id;
    const isAdmin = user.role === Role.ADMINISTRATOR;

    if (!isOwner && !isAdmin) {
      throw new ApiError(403, 'Unauthorized to extend this booking.');
    }

    // Only active CHECKED_IN bookings can be extended
    if (booking.status !== BookingStatus.CHECKED_IN) {
      throw new ApiError(
        409,
        `Cannot extend booking with status ${booking.status}. Only active CHECKED_IN bookings can be extended.`
      );
    }

    const currentEnd = new Date(booking.endTime);
    const newEnd = new Date(currentEnd.getTime() + durationMinutes * 60000);

    // Total duration <= 8 hours
    const totalHours = (newEnd.getTime() - booking.startTime.getTime()) / (1000 * 60 * 60);
    if (totalHours > 8) {
      throw new ApiError(400, 'Extended booking cannot exceed the 8-hour maximum limit.');
    }

    // Operating hours check
    const opCheck = validateOperatingHours(booking.startTime, newEnd, booking.resource.operatingHours);
    if (!opCheck.valid) {
      throw new ApiError(400, opCheck.reason || 'Extension exceeds facility operating hours.');
    }

    // Timetable clash during extension interval [currentEnd, newEnd)
    const dayOfWeek = getDayOfWeekInKolkata(currentEnd);
    const startHHMM = getTimeStringInKolkata(currentEnd);
    const endHHMM = getTimeStringInKolkata(newEnd);

    const timetableClash = await prisma.timetableEntry.findFirst({
      where: {
        resourceId: booking.resourceId,
        dayOfWeek,
        AND: [
          { startTime: { lt: endHHMM } },
          { endTime: { gt: startHHMM } },
        ],
      },
    });

    if (timetableClash) {
      throw new ApiError(
        409,
        `Cannot extend booking: Academic timetable conflict (${timetableClash.courseCode} - ${timetableClash.courseName}).`
      );
    }

    // Overlap check during extension interval [currentEnd, newEnd) excluding current booking
    const overlap = await prisma.booking.findFirst({
      where: {
        resourceId: booking.resourceId,
        id: { not: booking.id },
        status: {
          in: [
            BookingStatus.PENDING,
            BookingStatus.APPROVED,
            BookingStatus.CONFIRMED,
            BookingStatus.CHECKED_IN,
          ],
        },
        AND: [
          { startTime: { lt: newEnd } },
          { endTime: { gt: currentEnd } },
        ],
      },
    });

    if (overlap) {
      throw new ApiError(
        409,
        'Cannot extend booking: The following time slot is already reserved by another user.'
      );
    }

    // Transaction execution
    const updated = await prisma.$transaction(async (tx) => {
      // Re-verify overlap inside tx
      const txOverlap = await tx.booking.findFirst({
        where: {
          resourceId: booking.resourceId,
          id: { not: booking.id },
          status: {
            in: [
              BookingStatus.PENDING,
              BookingStatus.APPROVED,
              BookingStatus.CONFIRMED,
              BookingStatus.CHECKED_IN,
            ],
          },
          AND: [
            { startTime: { lt: newEnd } },
            { endTime: { gt: currentEnd } },
          ],
        },
      });

      if (txOverlap) {
        throw new ApiError(
          409,
          'Cannot extend booking: The following time slot was just reserved by another user.'
        );
      }

      const b = await tx.booking.update({
        where: { id },
        data: { endTime: newEnd },
        include: {
          resource: true,
          series: { select: { id: true, frequency: true, count: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'BOOKING_EXTENDED',
          userId: user.id,
          entityType: 'Booking',
          entityId: id,
          details: JSON.stringify({
            bookingNumber: booking.bookingNumber,
            previousEndTime: currentEnd.toISOString(),
            newEndTime: newEnd.toISOString(),
            extendedMinutes: durationMinutes,
          }),
        },
      });

      return b;
    });

    // Notify user
    try {
      await prisma.notification.create({
        data: {
          userId: booking.userId,
          title: `Booking Extended: ${booking.resource.name}`,
          message: `Booking #${booking.bookingNumber} has been extended by ${durationMinutes} minutes until ${getTimeStringInKolkata(newEnd)}.`,
          type: 'BOOKING',
          link: '/my-bookings?tab=UPCOMING',
        },
      });
    } catch {}

    const eligibility = BookingService.computeBookingEligibility(updated, user);
    const bookingListItem: BookingListItemDTO = {
      ...updated,
      startTime: updated.startTime.toISOString(),
      endTime: updated.endTime.toISOString(),
      actualEndTime: updated.actualEndTime ? updated.actualEndTime.toISOString() : null,
      checkedInAt: updated.checkedInAt ? updated.checkedInAt.toISOString() : null,
      releaseDeadline: updated.releaseDeadline ? updated.releaseDeadline.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      activityType: updated.activityType as any,
      priority: updated.priority as any,
      status: updated.status as any,
      resource: updated.resource as any,
      series: updated.series
        ? {
            id: updated.series.id,
            frequency: updated.series.frequency,
            totalCount: updated.series.count,
          }
        : null,
      eligibility,
    };

    return {
      booking: bookingListItem,
      previousEndTime: currentEnd.toISOString(),
      newEndTime: newEnd.toISOString(),
      extendedMinutes: durationMinutes,
      message: `Successfully extended reservation by ${durationMinutes} minutes.`,
    };
  }

  /**
   * Scheduled Job: Automatically completes expired CHECKED_IN bookings whose end time has passed.
   */
  static async autoCompleteExpiredBookings(): Promise<AutomaticCompletionJobResponse> {
    const now = new Date();
    const expiredCheckedIn = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CHECKED_IN,
        endTime: { lte: now },
      },
      include: { resource: true },
    });

    let completed = 0;
    let failed = 0;
    const errors: { id: string; error: string }[] = [];

    for (const b of expiredCheckedIn) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.booking.update({
            where: { id: b.id },
            data: {
              status: BookingStatus.COMPLETED,
              actualEndTime: b.endTime,
            },
          });

          await tx.auditLog.create({
            data: {
              action: 'BOOKING_AUTO_COMPLETED',
              userId: b.userId,
              entityType: 'Booking',
              entityId: b.id,
              details: JSON.stringify({
                bookingNumber: b.bookingNumber,
                scheduledEndTime: b.endTime.toISOString(),
                completedAt: now.toISOString(),
              }),
            },
          });
        });

        // Notify user
        try {
          await prisma.notification.create({
            data: {
              userId: b.userId,
              title: `Booking Completed: ${b.resource.name}`,
              message: `Your reservation #${b.bookingNumber} has concluded and was marked completed.`,
              type: 'BOOKING',
              link: '/my-bookings?tab=PAST',
            },
          });
        } catch {}

        completed++;
      } catch (err: any) {
        failed++;
        errors.push({ id: b.id, error: err.message || 'Failed to auto-complete booking' });
      }
    }

    return {
      processed: expiredCheckedIn.length,
      completed,
      skipped: 0,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully processed ${expiredCheckedIn.length} expired bookings: ${completed} completed, ${failed} failed.`,
    };
  }

  /**
   * My Bookings API: Provides paginated, tabbed bookings list with action eligibility.
   */
  static async getMyBookings(
    user: BookingUserContext,
    query: MyBookingsQuery
  ): Promise<MyBookingsResponse> {
    const tab: MyBookingsTab = query.tab || 'UPCOMING';
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(50, Math.max(1, query.limit || 10));
    const skip = (page - 1) * limit;
    const now = new Date();

    // Query filters based on tab
    let whereCondition: Prisma.BookingWhereInput = { userId: user.id };

    if (tab === 'UPCOMING') {
      whereCondition = {
        userId: user.id,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.CHECKED_IN] },
        endTime: { gte: now },
      };
    } else if (tab === 'PENDING') {
      whereCondition = {
        userId: user.id,
        status: BookingStatus.PENDING,
      };
    } else if (tab === 'PAST') {
      whereCondition = {
        userId: user.id,
        OR: [
          { status: BookingStatus.COMPLETED },
          { status: BookingStatus.NO_SHOW },
          {
            status: { in: [BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.CHECKED_IN] },
            endTime: { lt: now },
          },
        ],
      };
    } else if (tab === 'CANCELLED') {
      whereCondition = {
        userId: user.id,
        status: { in: [BookingStatus.CANCELLED, BookingStatus.REJECTED] },
      };
    }

    // Fetch tab counts in parallel
    const [upcomingCount, pendingCount, pastCount, cancelledCount, waitlistCount, total, items] =
      await Promise.all([
        prisma.booking.count({
          where: {
            userId: user.id,
            status: { in: [BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.CHECKED_IN] },
            endTime: { gte: now },
          },
        }),
        prisma.booking.count({
          where: {
            userId: user.id,
            status: BookingStatus.PENDING,
          },
        }),
        prisma.booking.count({
          where: {
            userId: user.id,
            OR: [
              { status: BookingStatus.COMPLETED },
              { status: BookingStatus.NO_SHOW },
              {
                status: { in: [BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.CHECKED_IN] },
                endTime: { lt: now },
              },
            ],
          },
        }),
        prisma.booking.count({
          where: {
            userId: user.id,
            status: { in: [BookingStatus.CANCELLED, BookingStatus.REJECTED] },
          },
        }),
        prisma.waitlistEntry.count({
          where: {
            userId: user.id,
            status: { in: ['WAITING', 'OFFERED'] },
          },
        }),
        prisma.booking.count({ where: whereCondition }),
        prisma.booking.findMany({
          where: whereCondition,
          include: {
            resource: true,
            series: {
              select: {
                id: true,
                frequency: true,
                count: true,
              },
            },
          },
          orderBy: [
            { startTime: tab === 'PAST' || tab === 'CANCELLED' ? 'desc' : 'asc' },
            { id: 'asc' },
          ],
          skip,
          take: limit,
        }),
      ]);

    const formattedBookings: BookingListItemDTO[] = items.map((b) => {
      const eligibility = BookingService.computeBookingEligibility(b, user);
      return {
        id: b.id,
        bookingNumber: b.bookingNumber,
        userId: b.userId,
        resourceId: b.resourceId,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
        actualEndTime: b.actualEndTime ? b.actualEndTime.toISOString() : null,
        purpose: b.purpose,
        activityType: b.activityType as any,
        expectedAttendance: b.expectedAttendance,
        priority: b.priority as any,
        status: b.status as any,
        checkInToken: b.checkInToken,
        checkedInAt: b.checkedInAt ? b.checkedInAt.toISOString() : null,
        releaseDeadline: b.releaseDeadline ? b.releaseDeadline.toISOString() : null,
        approvalNotes: b.approvalNotes,
        rejectionReason: b.rejectionReason,
        departmentId: b.departmentId,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
        resource: b.resource as any,
        series: b.series
          ? {
              id: b.series.id,
              frequency: b.series.frequency,
              totalCount: b.series.count,
            }
          : null,
        eligibility,
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      bookings: formattedBookings,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      tabCounts: {
        upcoming: upcomingCount,
        pending: pendingCount,
        past: pastCount,
        cancelled: cancelledCount,
        waitlist: waitlistCount,
      },
    };
  }

  /**
   * Lists bookings filtered by role permissions and query parameters.
   */
  static async listBookings(user: BookingUserContext, searchParams: URLSearchParams) {
    const status = searchParams.get('status');
    const resourceId = searchParams.get('resourceId');
    const upcomingOnly = searchParams.get('upcomingOnly');
    const myOnly = searchParams.get('myOnly');

    const where: Prisma.BookingWhereInput = {};

    // Permission Scope:
    // Students and Faculty (unless designated approvers/admins) can strictly only see their own bookings
    if (user.role === Role.STUDENT || user.role === Role.FACULTY || myOnly === 'true') {
      where.userId = user.id;
    } else if (user.role === Role.DEPARTMENT_APPROVER) {
      // Department approvers can view their department's bookings or their own
      where.OR = [
        { userId: user.id },
        { departmentId: user.department },
        { resource: { department: user.department } },
      ];
    }
    // Administrators can view all bookings without restrictions

    if (status) {
      where.status = status as BookingStatus;
    }

    if (resourceId) {
      where.resourceId = resourceId;
    }

    if (upcomingOnly === 'true') {
      where.endTime = { gte: new Date() };
    }

    return prisma.booking.findMany({
      where,
      include: {
        resource: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            regNo: true,
            department: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { startTime: 'desc' },
    });
  }
}
