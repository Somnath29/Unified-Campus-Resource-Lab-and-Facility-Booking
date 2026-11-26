import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { BookingStatus, ActivityType, PriorityLevel, Role, Prisma } from '@prisma/client';
import { ApiError } from '@/lib/auth';
import { validateOperatingHours, getDayOfWeekInKolkata, getTimeStringInKolkata } from '@/lib/timezone';
import { evaluateBookingPolicy } from './policyService';
import { validateBookingTransition, canCancelBooking } from '@lpu/shared';

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
async function generateUniqueCheckInPin(tx: Prisma.TransactionClient): Promise<string> {
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
async function getNextBookingNumber(tx: Prisma.TransactionClient): Promise<string> {
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
 * Centralized Booking Service owning all booking business logic, validations,
 * transaction execution, idempotency, and PostgreSQL exclusion constraint handling.
 */
export class BookingService {
  /**
   * Creates a new campus resource booking with full policy evaluation,
   * timetable conflict checks, idempotency, and double-booking concurrency safety.
   */
  static async createBooking({
    user,
    input,
    idempotencyKey,
  }: CreateBookingOptions): Promise<CreateBookingResult> {
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
      const existingKeyRecord = await prisma.idempotencyKey.findUnique({
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
    const resource = await prisma.resource.findUnique({
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

    const timetableConflicts = await prisma.timetableEntry.findMany({
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
      prisma,
    });

    if (!policyDecision.allowed) {
      throw new ApiError(422, policyDecision.reason || 'Booking rejected by department policy.');
    }

    const initialStatus = policyDecision.initialStatus;
    const releaseDeadline = new Date(start.getTime() + policyDecision.autoReleaseMinutes * 60000);

    // 7. Atomic Database Transaction with Exclusion Constraint Handling
    try {
      const result = await prisma.$transaction(async (tx) => {
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
            checkInToken,
            releaseDeadline,
            departmentId: resource.department,
          },
          include: {
            resource: true,
          },
        });

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

        const responsePayload = {
          booking: newBooking,
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
                ? `Your booking #${result.booking.bookingNumber} is confirmed for ${start.toLocaleDateString()}. Check-in code: ${result.booking.checkInToken}`
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
      // Handle PostgreSQL GiST exclusion constraint error code 23P01
      if (
        err?.code === '23P01' ||
        err?.message?.includes('23P01') ||
        err?.message?.includes('no_overlapping_bookings')
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
   * Cancels an eligible booking, enforcing state machine transitions,
   * permissions, notifications, and audit logging.
   */
  static async cancelBooking(id: string, user: BookingUserContext, reason?: string) {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { resource: true },
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

    // State Machine Validation
    if (!canCancelBooking(booking.status)) {
      throw new ApiError(
        400,
        `Cannot cancel booking with current status: ${booking.status}. Only PENDING, APPROVED, or CONFIRMED bookings may be cancelled.`
      );
    }

    validateBookingTransition(booking.status, BookingStatus.CANCELLED);

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id },
        data: {
          status: BookingStatus.CANCELLED,
          rejectionReason: reason || (isOwner ? 'Cancelled by requester' : `Cancelled by ${user.name}`),
        },
        include: { resource: true },
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
            reason: reason || 'Cancelled by requester',
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
          title: `Booking Cancelled: ${booking.resource.name}`,
          message: `Booking #${booking.bookingNumber} was cancelled. Reason: ${reason || 'Cancelled by user.'}`,
          type: 'BOOKING',
          link: '/my-bookings',
        },
      });
    } catch {
      // Non-fatal
    }

    return updated;
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
