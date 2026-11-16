import { prisma } from '../lib/prisma';
import { BookingStatus, Role, ResourceCategory, PriorityLevel } from '@prisma/client';
import { AuthenticatedUser } from '../middleware/auth';

export class ApprovalError extends Error {
  statusCode: number;
  details?: any;

  constructor(message: string, statusCode: number = 400, details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, ApprovalError.prototype);
  }
}

export interface ApprovalActionParams {
  bookingId: string;
  approver: AuthenticatedUser;
  action: 'APPROVE' | 'REJECT' | 'MODIFY' | 'REQUEST_INFO';
  reason?: string;
  notes?: string;
  question?: string;
  alternateResourceId?: string;
  newStartTime?: string | Date;
  newEndTime?: string | Date;
}

/**
 * Retrieves the list of department IDs the approver is authorized for,
 * including primary assignments and active delegations.
 * Administrators return null (unrestricted global access).
 */
export async function getAuthorizedDepartmentIds(user: AuthenticatedUser): Promise<string[] | null> {
  if (user.role === Role.ADMINISTRATOR) {
    return null; // Global access
  }

  const now = new Date();

  // 1. Fetch direct approver assignments
  const assignments = await prisma.approverAssignment.findMany({
    where: { userId: user.id },
    select: { departmentId: true },
  });

  // 2. Fetch active delegations where the user is the delegate
  const delegations = await prisma.delegation.findMany({
    where: {
      toUserId: user.id,
      startsAt: { lte: now },
      endsAt: { gte: now },
      revokedAt: null,
    },
    select: { departmentId: true },
  });

  const departmentIds = new Set<string>();
  assignments.forEach((a) => departmentIds.add(a.departmentId));
  delegations.forEach((d) => departmentIds.add(d.departmentId));

  // Fallback: Check user's own department if no explicit assignments exist
  if (departmentIds.size === 0 && user.department) {
    const dept = await prisma.department.findFirst({
      where: {
        OR: [
          { name: user.department },
          { code: user.department },
        ],
      },
    });
    if (dept) {
      departmentIds.add(dept.id);
    }
  }

  return Array.from(departmentIds);
}

/**
 * Validates operating hours string e.g. "08:00 AM - 08:00 PM" against target start and end times.
 */
function isWithinOperatingHours(operatingHours: string, start: Date, end: Date): boolean {
  if (!operatingHours || operatingHours.includes('notice') || operatingHours.includes('Event')) {
    return true; // Flexible or custom hours
  }

  try {
    const parts = operatingHours.split('-').map((s) => s.trim());
    if (parts.length !== 2) return true;

    const parseTime = (timeStr: string) => {
      const [time, modifier] = timeStr.split(' ');
      let [hours, minutes] = time.split(':').map(Number);
      if (modifier === 'PM' && hours < 12) hours += 12;
      if (modifier === 'AM' && hours === 12) hours = 0;
      return hours * 60 + (minutes || 0);
    };

    const openMin = parseTime(parts[0]);
    const closeMin = parseTime(parts[1]);

    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();

    return startMin >= openMin && endMin <= closeMin;
  } catch {
    return true;
  }
}

/**
 * Core Approval Decision Engine (Task P3)
 * Processes APPROVE, REJECT, MODIFY, and REQUEST_INFO inside a row-locked transaction.
 */
export async function processApprovalAction(params: ApprovalActionParams) {
  const {
    bookingId,
    approver,
    action,
    reason,
    notes,
    question,
    alternateResourceId,
    newStartTime,
    newEndTime,
  } = params;

  // 1. Basic Action-Specific Validation
  if (!['APPROVE', 'REJECT', 'MODIFY', 'REQUEST_INFO'].includes(action)) {
    throw new ApprovalError('Invalid approval action specified.', 400);
  }

  if (action === 'REJECT') {
    const effectiveReason = (reason || notes || '').trim();
    if (effectiveReason.length < 10) {
      throw new ApprovalError('A rejection reason of at least 10 characters is required.', 400);
    }
  }

  if (action === 'REQUEST_INFO') {
    const effectiveQuestion = (question || notes || reason || '').trim();
    if (effectiveQuestion.length < 5) {
      throw new ApprovalError('A clarification question of at least 5 characters is required.', 400);
    }
  }

  if (action === 'MODIFY') {
    const effectiveNotes = (notes || reason || '').trim();
    if (effectiveNotes.length < 10) {
      throw new ApprovalError('A modification reason of at least 10 characters is required.', 400);
    }
  }

  // 2. Department Authorization Check (Pre-Transaction)
  const authorizedDeptIds = await getAuthorizedDepartmentIds(approver);

  // 3. Execute Decision in an Interactive Transaction with Row Lock
  return await prisma.$transaction(async (tx) => {
    // 3a. Acquire Row Lock using SELECT ... FOR UPDATE
    const lockedRows = await tx.$queryRaw<any[]>`
      SELECT id, status, "userId", "resourceId", "startTime", "endTime", "departmentId", "bookingNumber"
      FROM "Booking"
      WHERE id = ${bookingId}
      FOR UPDATE
    `;

    if (!lockedRows || lockedRows.length === 0) {
      throw new ApprovalError('Booking request not found.', 404);
    }

    const lockedBooking = lockedRows[0];

    // Load full booking context with relations inside the locked transaction
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        resource: true,
        user: true,
        department: true,
      },
    });

    if (!booking) {
      throw new ApprovalError('Booking request not found.', 404);
    }

    // 3b. Department Scope Enforcement
    if (authorizedDeptIds !== null) {
      const bookingDeptId = booking.departmentId || booking.resource?.departmentId;
      const isAuthorized = bookingDeptId ? authorizedDeptIds.includes(bookingDeptId) : false;
      if (!isAuthorized) {
        throw new ApprovalError(
          'Forbidden: You do not have approval permissions for this department resource.',
          403
        );
      }
    }

    // 3c. Block Self-Approval
    if (booking.userId === approver.id) {
      throw new ApprovalError(
        'Forbidden: Approvers cannot approve or decide their own reservations.',
        403
      );
    }

    // 3d. Idempotency Check: Repeating the same action returns previous result without duplicate side-effects
    const lastDecision = await tx.approvalDecision.findFirst({
      where: {
        bookingId: booking.id,
        approverId: approver.id,
        action,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (
      lastDecision &&
      ((action === 'APPROVE' && booking.status === BookingStatus.CONFIRMED) ||
        (action === 'REJECT' && booking.status === BookingStatus.REJECTED) ||
        (action === 'REQUEST_INFO' && booking.status === BookingStatus.NEEDS_INFO) ||
        (action === 'MODIFY' && booking.status === BookingStatus.CONFIRMED))
    ) {
      return {
        booking,
        message: `Action ${action} already applied previously (idempotent response).`,
        decision: lastDecision,
        isIdempotent: true,
      };
    }

    // 3e. Status Check: Must be PENDING to proceed
    if (booking.status !== BookingStatus.PENDING) {
      throw new ApprovalError(
        `Slot status conflict: Booking #${booking.bookingNumber} is in status ${booking.status}, expected PENDING.`,
        409
      );
    }

    const now = new Date();
    const beforeSnapshot = {
      status: booking.status,
      resourceId: booking.resourceId,
      resourceName: booking.resource?.name,
      startTime: booking.startTime.toISOString(),
      endTime: booking.endTime.toISOString(),
    };

    // 3f. Determine Policy and autoReleaseMinutes
    const departmentPolicy = await tx.departmentPolicy.findFirst({
      where: {
        OR: [
          { departmentId: booking.departmentId || undefined },
          { department: booking.resource?.department || '' },
        ],
      },
    });
    const autoReleaseMinutes = departmentPolicy?.autoReleaseMinutes || 15;

    // =========================================================================
    // ACTION: APPROVE
    // =========================================================================
    if (action === 'APPROVE') {
      // Re-verify that target room is not in maintenance
      if (booking.resource.isUnderMaintenance) {
        throw new ApprovalError(
          `Resource ${booking.resource.name} is currently under maintenance: ${booking.resource.maintenanceReason || 'Scheduled upkeep'}.`,
          400
        );
      }

      // Re-verify no overlapping confirmed/checked-in bookings exist
      const conflictingBooking = await tx.booking.findFirst({
        where: {
          resourceId: booking.resourceId,
          id: { not: booking.id },
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.APPROVED] },
          startTime: { lt: booking.endTime },
          endTime: { gt: booking.startTime },
        },
      });

      if (conflictingBooking) {
        throw new ApprovalError(
          `Slot conflict: The selected resource is already confirmed for booking #${conflictingBooking.bookingNumber} during this time window.`,
          409,
          { conflictingBookingNumber: conflictingBooking.bookingNumber }
        );
      }

      const checkInToken = Math.floor(100000 + Math.random() * 900000).toString();
      const releaseDeadline = new Date(booking.startTime.getTime() + autoReleaseMinutes * 60000);
      const approvalNotes = notes || reason || `Approved by ${approver.name} (${approver.designation || approver.role})`;

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CONFIRMED,
          approvalNotes,
          checkInToken,
          releaseDeadline,
          decidedAt: now,
          decidedById: approver.id,
        },
      });

      const decision = await tx.approvalDecision.create({
        data: {
          bookingId,
          approverId: approver.id,
          action: 'APPROVE',
          reason: approvalNotes,
          before: beforeSnapshot,
          after: {
            status: BookingStatus.CONFIRMED,
            checkInToken,
            releaseDeadline: releaseDeadline.toISOString(),
          },
        },
      });

      // Notification
      await tx.notification.create({
        data: {
          userId: booking.userId,
          title: `Request Approved: ${booking.resource.name}`,
          message: `Your booking #${booking.bookingNumber} has been approved. Check-in code is ${checkInToken}. Check-in closes in ${autoReleaseMinutes} minutes after start time.`,
          type: 'APPROVAL',
          link: '/my-bookings',
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          action: 'BOOKING_APPROVED',
          userId: approver.id,
          entityType: 'Booking',
          entityId: bookingId,
          details: `Approved booking #${booking.bookingNumber} for ${booking.resource.name} with ${autoReleaseMinutes}m release window`,
        },
      });

      return {
        booking: updated,
        decision,
        message: 'Booking request approved successfully.',
      };
    }

    // =========================================================================
    // ACTION: REJECT
    // =========================================================================
    if (action === 'REJECT') {
      const rejectionReason = (reason || notes)!.trim();

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.REJECTED,
          rejectionReason,
          decidedAt: now,
          decidedById: approver.id,
        },
      });

      const decision = await tx.approvalDecision.create({
        data: {
          bookingId,
          approverId: approver.id,
          action: 'REJECT',
          reason: rejectionReason,
          before: beforeSnapshot,
          after: {
            status: BookingStatus.REJECTED,
            rejectionReason,
          },
        },
      });

      // Notification
      await tx.notification.create({
        data: {
          userId: booking.userId,
          title: `Request Declined: ${booking.resource.name}`,
          message: `Your booking request #${booking.bookingNumber} was declined. Reason: ${rejectionReason}`,
          type: 'APPROVAL',
          link: '/my-bookings',
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          action: 'BOOKING_REJECTED',
          userId: approver.id,
          entityType: 'Booking',
          entityId: bookingId,
          details: `Rejected booking #${booking.bookingNumber}. Reason: ${rejectionReason}`,
        },
      });

      return {
        booking: updated,
        decision,
        message: 'Booking request rejected.',
      };
    }

    // =========================================================================
    // ACTION: REQUEST_INFO
    // =========================================================================
    if (action === 'REQUEST_INFO') {
      const questionText = (question || notes || reason)!.trim();

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.NEEDS_INFO,
          approvalNotes: `Information requested: ${questionText}`,
        },
      });

      // Add Booking Comment
      await tx.bookingComment.create({
        data: {
          bookingId,
          authorId: approver.id,
          body: questionText,
          isInternal: false,
        },
      });

      const decision = await tx.approvalDecision.create({
        data: {
          bookingId,
          approverId: approver.id,
          action: 'REQUEST_INFO',
          reason: questionText,
          before: beforeSnapshot,
          after: {
            status: BookingStatus.NEEDS_INFO,
            question: questionText,
          },
        },
      });

      // Notification
      await tx.notification.create({
        data: {
          userId: booking.userId,
          title: `Action Needed: ${booking.resource.name}`,
          message: `Approver requested details for #${booking.bookingNumber}: "${questionText}". Please reply from My Bookings.`,
          type: 'APPROVAL',
          link: '/my-bookings',
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          action: 'BOOKING_NEEDS_INFO',
          userId: approver.id,
          entityType: 'Booking',
          entityId: bookingId,
          details: `Requested clarification on booking #${booking.bookingNumber}: ${questionText}`,
        },
      });

      return {
        booking: updated,
        decision,
        message: 'Information request sent to requester.',
      };
    }

    // =========================================================================
    // ACTION: MODIFY (Re-validate conflicts, maintenance, hours, capacity & policy)
    // =========================================================================
    if (action === 'MODIFY') {
      const targetResourceId = alternateResourceId || booking.resourceId;
      const targetStart = newStartTime ? new Date(newStartTime) : booking.startTime;
      const targetEnd = newEndTime ? new Date(newEndTime) : booking.endTime;

      if (targetEnd <= targetStart) {
        throw new ApprovalError('End time must be after start time.', 400);
      }

      // Fetch target resource
      const targetResource =
        targetResourceId === booking.resourceId
          ? booking.resource
          : await tx.resource.findUnique({ where: { id: targetResourceId } });

      if (!targetResource) {
        throw new ApprovalError('Selected alternative resource does not exist.', 404);
      }

      // 1. Maintenance Check
      if (targetResource.isUnderMaintenance) {
        throw new ApprovalError(
          `Resource ${targetResource.name} is currently under maintenance: ${targetResource.maintenanceReason || 'Scheduled upkeep'}.`,
          400
        );
      }

      // 2. Capacity Check
      if (booking.expectedAttendance > targetResource.capacity) {
        throw new ApprovalError(
          `Expected attendance (${booking.expectedAttendance}) exceeds capacity (${targetResource.capacity}) of ${targetResource.name}.`,
          400
        );
      }

      // 3. Operating Hours Check
      if (!isWithinOperatingHours(targetResource.operatingHours, targetStart, targetEnd)) {
        throw new ApprovalError(
          `Selected time falls outside operating hours (${targetResource.operatingHours}) for ${targetResource.name}.`,
          400
        );
      }

      // 4. Overlap Conflict Check
      const conflictingBooking = await tx.booking.findFirst({
        where: {
          resourceId: targetResourceId,
          id: { not: booking.id },
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.APPROVED, BookingStatus.PENDING] },
          startTime: { lt: targetEnd },
          endTime: { gt: targetStart },
        },
      });

      if (conflictingBooking) {
        throw new ApprovalError(
          `Slot conflict: ${targetResource.name} is already occupied or pending by booking #${conflictingBooking.bookingNumber} during this time window.`,
          409,
          { conflictingBookingNumber: conflictingBooking.bookingNumber }
        );
      }

      // 5. Timetable Conflict Check
      const dayOfWeek = targetStart.getDay();
      const startHM = `${String(targetStart.getHours()).padStart(2, '0')}:${String(targetStart.getMinutes()).padStart(2, '0')}`;
      const endHM = `${String(targetEnd.getHours()).padStart(2, '0')}:${String(targetEnd.getMinutes()).padStart(2, '0')}`;

      const timetableClash = await tx.timetableEntry.findFirst({
        where: {
          resourceId: targetResourceId,
          dayOfWeek,
          startTime: { lt: endHM },
          endTime: { gt: startHM },
        },
      });

      if (timetableClash) {
        throw new ApprovalError(
          `Academic timetable clash: ${targetResource.name} has scheduled class ${timetableClash.courseCode} (${timetableClash.courseName}) at this time.`,
          409,
          { classClash: timetableClash }
        );
      }

      // Re-calculate release deadline with target department's policy
      const targetDeptPolicy = await tx.departmentPolicy.findFirst({
        where: {
          OR: [
            { departmentId: targetResource.departmentId || undefined },
            { department: targetResource.department || '' },
          ],
        },
      });
      const targetAutoReleaseMinutes = targetDeptPolicy?.autoReleaseMinutes || 15;

      const checkInToken = Math.floor(100000 + Math.random() * 900000).toString();
      const releaseDeadline = new Date(targetStart.getTime() + targetAutoReleaseMinutes * 60000);
      const modificationNotes =
        notes || reason || `Modified and approved by ${approver.name}. Assigned to ${targetResource.name}.`;

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          resourceId: targetResourceId,
          departmentId: targetResource.departmentId || booking.departmentId,
          startTime: targetStart,
          endTime: targetEnd,
          status: BookingStatus.CONFIRMED,
          approvalNotes: modificationNotes,
          checkInToken,
          releaseDeadline,
          decidedAt: now,
          decidedById: approver.id,
        },
      });

      const decision = await tx.approvalDecision.create({
        data: {
          bookingId,
          approverId: approver.id,
          action: 'MODIFY',
          reason: modificationNotes,
          before: beforeSnapshot,
          after: {
            status: BookingStatus.CONFIRMED,
            resourceId: targetResourceId,
            resourceName: targetResource.name,
            startTime: targetStart.toISOString(),
            endTime: targetEnd.toISOString(),
            checkInToken,
          },
        },
      });

      // Notification
      await tx.notification.create({
        data: {
          userId: booking.userId,
          title: `Booking Modified & Approved: ${targetResource.name}`,
          message: `Your booking #${booking.bookingNumber} was modified and approved for ${targetResource.name}. New check-in code is ${checkInToken}.`,
          type: 'APPROVAL',
          link: '/my-bookings',
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          action: 'BOOKING_MODIFIED',
          userId: approver.id,
          entityType: 'Booking',
          entityId: bookingId,
          details: `Modified and confirmed #${booking.bookingNumber} to ${targetResource.name} (${targetStart.toISOString()} - ${targetEnd.toISOString()})`,
        },
      });

      return {
        booking: updated,
        decision,
        message: `Booking modified and approved for ${targetResource.name}.`,
      };
    }

    throw new ApprovalError('Unhandled approval action.', 400);
  });
}
