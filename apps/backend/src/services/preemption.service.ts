import { prisma } from '../lib/prisma';
import {
  BookingStatus,
  Role,
  ActivityType,
  PriorityLevel,
  PreemptionStatus,
} from '@prisma/client';
import { AuthenticatedUser } from '../middleware/auth';
import { getAuthorizedDepartmentIds, ApprovalError } from './approvalService';
import crypto from 'crypto';

export interface BookingPriorityContext {
  priority: PriorityLevel;
  activityType: ActivityType;
  userRole: Role;
  submittedAt?: Date | string;
}

/**
 * Calculates a centralized numeric priority score for any booking request or reservation.
 * Higher score = higher priority.
 *
 * Requirements:
 * 1. Exam/evaluation activities outrank all bookings (Base +5000)
 * 2. PriorityLevel: URGENT (+2000), HIGH (+1000), NORMAL (0)
 * 3. Faculty events outrank student club events:
 *    - Faculty (+300)
 *    - Faculty meeting (+200) vs Club event (-100)
 * 4. Ties broken by earlier submission time (first-come, first-served)
 */
export function calculatePriorityScore(booking: {
  priority?: PriorityLevel | string;
  activityType?: ActivityType | string;
  userRole?: Role | string;
  user?: { role?: Role | string };
  submittedAt?: Date | string;
}): number {
  let score = 0;

  // 1. Exam / Evaluation Activity outranks all normal/club bookings
  const act = booking.activityType;
  if (act === ActivityType.EXAM_EVALUATION || act === 'EXAM_EVALUATION') {
    score += 5000;
  } else if (act === ActivityType.CLASS_LECTURE || act === 'CLASS_LECTURE') {
    score += 1500;
  } else if (act === ActivityType.LAB_SESSION || act === 'LAB_SESSION') {
    score += 1200;
  } else if (act === ActivityType.FACULTY_MEETING || act === 'FACULTY_MEETING') {
    score += 800;
  } else if (act === ActivityType.GUEST_SEMINAR || act === 'GUEST_SEMINAR') {
    score += 600;
  } else if (act === ActivityType.PROJECT_WORK || act === 'PROJECT_WORK') {
    score += 300;
  } else if (act === ActivityType.CLUB_EVENT || act === 'CLUB_EVENT') {
    score += 100;
  } else if (act === ActivityType.SPORTS_PRACTICE || act === 'SPORTS_PRACTICE') {
    score += 100;
  }

  // 2. Priority Level (URGENT > HIGH > NORMAL)
  const prio = booking.priority;
  if (prio === PriorityLevel.URGENT || prio === 'URGENT') {
    score += 2000;
  } else if (prio === PriorityLevel.HIGH || prio === 'HIGH') {
    score += 1000;
  }

  // 3. Requester Role: Faculty events outrank student events
  const role = booking.userRole || booking.user?.role;
  if (role === Role.FACULTY || role === 'FACULTY') {
    score += 400;
  } else if (role === Role.DEPARTMENT_APPROVER || role === 'DEPARTMENT_APPROVER') {
    score += 350;
  } else if (role === Role.ADMINISTRATOR || role === 'ADMINISTRATOR') {
    score += 500;
  }

  return score;
}

/**
 * Compares two bookings:
 * Returns positive if bookingA outranks bookingB.
 * Returns negative if bookingB outranks bookingA.
 * Returns 0 if equal.
 */
export function compareBookingPriority(
  bookingA: {
    priority?: PriorityLevel | string;
    activityType?: ActivityType | string;
    userRole?: Role | string;
    user?: { role?: Role | string };
    submittedAt?: Date | string;
  },
  bookingB: {
    priority?: PriorityLevel | string;
    activityType?: ActivityType | string;
    userRole?: Role | string;
    user?: { role?: Role | string };
    submittedAt?: Date | string;
  }
): number {
  const scoreA = calculatePriorityScore(bookingA);
  const scoreB = calculatePriorityScore(bookingB);

  if (scoreA !== scoreB) {
    return scoreA - scoreB;
  }

  // If score is identical, earlier submittedAt wins
  const timeA = bookingA.submittedAt ? new Date(bookingA.submittedAt).getTime() : 0;
  const timeB = bookingB.submittedAt ? new Date(bookingB.submittedAt).getTime() : 0;
  return timeB - timeA; // earlier submission has lower timestamp, so diff gives positive for earlier
}

export interface PreemptCandidateDTO {
  id: string;
  bookingNumber: string;
  requesterName: string;
  requesterRole: Role;
  purpose: string;
  activityType: ActivityType;
  priority: PriorityLevel;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  priorityScore: number;
  qualifies: boolean;
  qualificationReason: string;
  requiresAdminConfirmation: boolean;
}

/**
 * Finds all confirmed overlapping reservations that could be candidates for controlled pre-emption.
 * NEVER pre-empts bookings that are already CHECKED_IN.
 */
export async function getPreemptionCandidates(
  urgentBookingId: string,
  approver: AuthenticatedUser
): Promise<{
  urgentBooking: any;
  urgentScore: number;
  candidates: PreemptCandidateDTO[];
}> {
  const urgentBooking = await prisma.booking.findUnique({
    where: { id: urgentBookingId },
    include: {
      resource: true,
      user: true,
      department: true,
    },
  });

  if (!urgentBooking) {
    throw new ApprovalError('Urgent booking request not found.', 404);
  }

  // Department Authorization Check
  const authorizedDeptIds = await getAuthorizedDepartmentIds(approver);
  if (authorizedDeptIds !== null) {
    const bookingDeptId = urgentBooking.departmentId || urgentBooking.resource?.departmentId;
    const isAuthorized = bookingDeptId ? authorizedDeptIds.includes(bookingDeptId) : false;
    if (!isAuthorized) {
      throw new ApprovalError(
        'Forbidden: You do not have approval permissions for this department resource.',
        403
      );
    }
  }

  const urgentScore = calculatePriorityScore({
    priority: urgentBooking.priority,
    activityType: urgentBooking.activityType,
    userRole: urgentBooking.user.role,
    submittedAt: urgentBooking.submittedAt,
  });

  // Find all conflicting confirmed/approved bookings
  const conflictingBookings = await prisma.booking.findMany({
    where: {
      resourceId: urgentBooking.resourceId,
      id: { not: urgentBooking.id },
      status: {
        in: [
          BookingStatus.CONFIRMED,
          BookingStatus.APPROVED,
          BookingStatus.CHECKED_IN,
        ],
      },
      startTime: { lt: urgentBooking.endTime },
      endTime: { gt: urgentBooking.startTime },
    },
    include: {
      user: true,
      resource: true,
    },
    orderBy: { startTime: 'asc' },
  });

  const candidates: PreemptCandidateDTO[] = conflictingBookings.map((cb) => {
    const candidateScore = calculatePriorityScore({
      priority: cb.priority,
      activityType: cb.activityType,
      userRole: cb.user.role,
      submittedAt: cb.submittedAt,
    });

    const isCheckedIn = cb.status === BookingStatus.CHECKED_IN;
    const outranks = urgentScore > candidateScore;
    const qualifies = !isCheckedIn && outranks;

    let qualificationReason = '';
    if (isCheckedIn) {
      qualificationReason = 'Protected: Reservation is already CHECKED_IN and physically occupying the facility.';
    } else if (!outranks) {
      qualificationReason = `Ineligible: Confirmed booking priority score (${candidateScore}) is equal to or higher than urgent request score (${urgentScore}).`;
    } else {
      qualificationReason = `Qualifies: Urgent request priority (${urgentScore}) strictly outranks confirmed booking (${candidateScore}).`;
    }

    const requiresAdminConfirmation = cb.user.role === Role.FACULTY;

    return {
      id: cb.id,
      bookingNumber: cb.bookingNumber,
      requesterName: cb.user.name,
      requesterRole: cb.user.role,
      purpose: cb.purpose,
      activityType: cb.activityType,
      priority: cb.priority,
      startTime: cb.startTime.toISOString(),
      endTime: cb.endTime.toISOString(),
      status: cb.status,
      priorityScore: candidateScore,
      qualifies,
      qualificationReason,
      requiresAdminConfirmation,
    };
  });

  return { urgentBooking, urgentScore, candidates };
}

export interface RequestPreemptionParams {
  urgentBookingId: string;
  bumpedBookingId: string;
  approver: AuthenticatedUser;
  reason: string;
}

/**
 * Initiates or executes controlled pre-emption.
 * - If bumped booking is FACULTY, status becomes PENDING_ADMIN_CONFIRMATION until an ADMINISTRATOR approves.
 * - If bumped booking is non-faculty (e.g. STUDENT), pre-emption is completed immediately in an ACID row-locked transaction.
 */
export async function executePreemption(params: RequestPreemptionParams) {
  const { urgentBookingId, bumpedBookingId, approver, reason } = params;

  if (!reason || reason.trim().length < 10) {
    throw new ApprovalError('A pre-emption reason of at least 10 characters is mandatory.', 400);
  }

  const authorizedDeptIds = await getAuthorizedDepartmentIds(approver);

  return await prisma.$transaction(async (tx) => {
    // 1. Acquire row lock on both bookings
    const lockedUrgent = await tx.booking.findUnique({
      where: { id: urgentBookingId },
      include: { user: true, resource: true, department: true },
    });
    const lockedBumped = await tx.booking.findUnique({
      where: { id: bumpedBookingId },
      include: { user: true, resource: true, department: true },
    });

    if (!lockedUrgent || !lockedBumped) {
      throw new ApprovalError('One or both booking records were not found.', 404);
    }

    // 2. Department scope check
    if (authorizedDeptIds !== null) {
      const uDept = lockedUrgent.departmentId || lockedUrgent.resource?.departmentId;
      const bDept = lockedBumped.departmentId || lockedBumped.resource?.departmentId;
      if (!uDept || !authorizedDeptIds.includes(uDept) || !bDept || !authorizedDeptIds.includes(bDept)) {
        throw new ApprovalError(
          'Forbidden: You do not have approval authorization across all affected department resources.',
          403
        );
      }
    }

    // 3. Status re-validation
    if (lockedUrgent.status !== BookingStatus.PENDING) {
      throw new ApprovalError(
        `Urgent request #${lockedUrgent.bookingNumber} is not in PENDING state (found: ${lockedUrgent.status}).`,
        409
      );
    }

    if (lockedBumped.status === BookingStatus.CHECKED_IN) {
      throw new ApprovalError(
        `Cannot pre-empt #${lockedBumped.bookingNumber}: Booking is already CHECKED_IN. Checked-in sessions are strictly protected.`,
        400
      );
    }

    if (
      lockedBumped.status !== BookingStatus.CONFIRMED &&
      lockedBumped.status !== BookingStatus.APPROVED
    ) {
      throw new ApprovalError(
        `Target booking #${lockedBumped.bookingNumber} is not CONFIRMED/APPROVED (found: ${lockedBumped.status}).`,
        409
      );
    }

    // 4. Overlap re-validation
    if (
      lockedUrgent.resourceId !== lockedBumped.resourceId ||
      lockedUrgent.startTime >= lockedBumped.endTime ||
      lockedUrgent.endTime <= lockedBumped.startTime
    ) {
      throw new ApprovalError('The two bookings do not overlap on the same resource and time window.', 400);
    }

    // 5. Priority re-validation
    const urgentScore = calculatePriorityScore({
      priority: lockedUrgent.priority,
      activityType: lockedUrgent.activityType,
      userRole: lockedUrgent.user.role,
      submittedAt: lockedUrgent.submittedAt,
    });
    const bumpedScore = calculatePriorityScore({
      priority: lockedBumped.priority,
      activityType: lockedBumped.activityType,
      userRole: lockedBumped.user.role,
      submittedAt: lockedBumped.submittedAt,
    });

    if (urgentScore <= bumpedScore) {
      throw new ApprovalError(
        `Priority rule violation: Urgent request score (${urgentScore}) does not strictly outrank target booking score (${bumpedScore}).`,
        400
      );
    }

    const isFacultyBumped = lockedBumped.user.role === Role.FACULTY;
    const now = new Date();

    // 6. Faculty Protection Check
    // If the bumped user is faculty and approver is NOT an Administrator:
    // Create preemption record in PENDING_ADMIN_CONFIRMATION state.
    if (isFacultyBumped && approver.role !== Role.ADMINISTRATOR) {
      const preemptionRecord = await tx.preemptionRecord.create({
        data: {
          targetBookingId: urgentBookingId,
          bumpedBookingId: bumpedBookingId,
          initiatorId: approver.id,
          reason: reason.trim(),
          requiresAdminConfirmation: true,
          status: PreemptionStatus.PENDING_ADMIN_CONFIRMATION,
          bumpedOriginalCheckInToken: lockedBumped.checkInToken,
          bumpedOriginalReleaseDeadline: lockedBumped.releaseDeadline,
        },
      });

      // Audit Log for Preemption Initiation
      await tx.auditLog.create({
        data: {
          action: 'PREEMPTION_PENDING_ADMIN',
          userId: approver.id,
          entityType: 'PreemptionRecord',
          entityId: preemptionRecord.id,
          details: `Approver ${approver.name} requested faculty pre-emption of #${lockedBumped.bookingNumber} (${lockedBumped.user.name}) for urgent #${lockedUrgent.bookingNumber}. Awaiting Admin confirmation. Reason: ${reason}`,
        },
      });

      // Notify Admins
      const admins = await tx.user.findMany({ where: { role: Role.ADMINISTRATOR } });
      for (const admin of admins) {
        await tx.notification.create({
          data: {
            userId: admin.id,
            title: `Admin Action Required: Faculty Pre-emption Confirmation`,
            message: `Department Approver ${approver.name} requested pre-emption of Faculty booking #${lockedBumped.bookingNumber} (${lockedBumped.user.name}) for urgent booking #${lockedUrgent.bookingNumber}. Please review and confirm.`,
            type: 'APPROVAL',
            link: '/admin',
          },
        });
      }

      return {
        status: PreemptionStatus.PENDING_ADMIN_CONFIRMATION,
        requiresAdminConfirmation: true,
        preemptionRecord,
        message:
          'Faculty booking detected. Pre-emption request registered and forwarded to Administrator for mandatory second confirmation.',
      };
    }

    // 7. Complete Immediate Pre-emption (Non-Faculty or Administrator-Executed)
    return await completePreemptionTransaction({
      tx,
      urgentBooking: lockedUrgent,
      bumpedBooking: lockedBumped,
      initiator: approver,
      adminApprover: approver.role === Role.ADMINISTRATOR ? approver : undefined,
      reason: reason.trim(),
      now,
    });
  });
}

/**
 * Internal transaction logic to cancel the bumped booking, confirm the urgent booking,
 * place the bumped user first on the waitlist, and record audit/notifications.
 */
async function completePreemptionTransaction({
  tx,
  urgentBooking,
  bumpedBooking,
  initiator,
  adminApprover,
  reason,
  now,
}: {
  tx: any;
  urgentBooking: any;
  bumpedBooking: any;
  initiator: AuthenticatedUser;
  adminApprover?: AuthenticatedUser;
  reason: string;
  now: Date;
}) {
  // 5-minute undo window
  const canUndoUntil = new Date(now.getTime() + 5 * 60000);

  // 1. Cancel Bumped Booking
  const cancellationReason = `Pre-empted by urgent priority booking #${urgentBooking.bookingNumber}. Reason: ${reason}`;
  const updatedBumped = await tx.booking.update({
    where: { id: bumpedBooking.id },
    data: {
      status: BookingStatus.CANCELLED,
      rejectionReason: cancellationReason,
      decidedAt: now,
      decidedById: initiator.id,
    },
  });

  // 2. Confirm Urgent Booking with Check-In Token
  const departmentPolicy = await tx.departmentPolicy.findFirst({
    where: {
      OR: [
        { departmentId: urgentBooking.departmentId || undefined },
        { department: urgentBooking.resource?.department || '' },
      ],
    },
  });
  const autoReleaseMinutes = departmentPolicy?.autoReleaseMinutes ?? 15;
  const checkInToken = crypto.randomInt(100000, 1000000).toString();
  const releaseDeadline = new Date(urgentBooking.startTime.getTime() + autoReleaseMinutes * 60000);

  const updatedUrgent = await tx.booking.update({
    where: { id: urgentBooking.id },
    data: {
      status: BookingStatus.CONFIRMED,
      approvalNotes: `Approved via controlled pre-emption over #${bumpedBooking.bookingNumber}. Reason: ${reason}`,
      checkInToken,
      releaseDeadline,
      decidedAt: now,
      decidedById: initiator.id,
    },
  });

  // 3. Place bumped booking as FIRST PRIORITY (priority: 100) on Alternative Resource Waitlist
  const waitlistEntry = await tx.waitlistEntry.create({
    data: {
      bookingId: bumpedBooking.id,
      resourceId: bumpedBooking.resourceId,
      userId: bumpedBooking.userId,
      priority: 100, // Top priority for displaced/bumped reservations
      reason: `Pre-empted by #${urgentBooking.bookingNumber}. First priority on alternative allocation waitlist.`,
    },
  });

  // 4. Create PreemptionRecord
  const preemptionRecord = await tx.preemptionRecord.create({
    data: {
      targetBookingId: urgentBooking.id,
      bumpedBookingId: bumpedBooking.id,
      initiatorId: initiator.id,
      reason,
      requiresAdminConfirmation: bumpedBooking.user.role === Role.FACULTY,
      adminApproverId: adminApprover?.id,
      adminConfirmedAt: adminApprover ? now : null,
      status: PreemptionStatus.COMPLETED,
      canUndoUntil,
      bumpedOriginalCheckInToken: bumpedBooking.checkInToken,
      bumpedOriginalReleaseDeadline: bumpedBooking.releaseDeadline,
    },
  });

  // 5. Audit Log Decisions
  await tx.approvalDecision.create({
    data: {
      bookingId: urgentBooking.id,
      approverId: initiator.id,
      action: 'PREEMPT_CONFIRM',
      reason,
      before: { status: urgentBooking.status },
      after: {
        status: BookingStatus.CONFIRMED,
        checkInToken,
        preemptedBookingNumber: bumpedBooking.bookingNumber,
      },
    },
  });

  await tx.approvalDecision.create({
    data: {
      bookingId: bumpedBooking.id,
      approverId: initiator.id,
      action: 'PREEMPT_BUMPED',
      reason: cancellationReason,
      before: {
        status: bumpedBooking.status,
        checkInToken: bumpedBooking.checkInToken,
      },
      after: {
        status: BookingStatus.CANCELLED,
        waitlistPriority: 100,
        waitlistEntryId: waitlistEntry.id,
      },
    },
  });

  await tx.auditLog.create({
    data: {
      action: 'BOOKING_PREEMPTED',
      userId: initiator.id,
      entityType: 'PreemptionRecord',
      entityId: preemptionRecord.id,
      details: `Pre-empted booking #${bumpedBooking.bookingNumber} (${bumpedBooking.user.name}) for #${urgentBooking.bookingNumber} (${urgentBooking.user.name}). Placed on waitlist priority 100. Undo allowed until ${canUndoUntil.toISOString()}`,
    },
  });

  // 6. Notifications
  // Notify Bumped User
  await tx.notification.create({
    data: {
      userId: bumpedBooking.userId,
      title: `Booking Pre-empted: #${bumpedBooking.bookingNumber} on ${bumpedBooking.resource.name}`,
      message: `Your reservation #${bumpedBooking.bookingNumber} has been pre-empted for an urgent institutional event (${reason}). You have been placed with #1 top priority on the alternative resource waitlist.`,
      type: 'APPROVAL',
      link: '/my-bookings',
    },
  });

  // Notify Urgent Requester
  await tx.notification.create({
    data: {
      userId: urgentBooking.userId,
      title: `Urgent Request Confirmed via Pre-emption: ${urgentBooking.resource.name}`,
      message: `Your booking #${urgentBooking.bookingNumber} has been approved and confirmed. Check-in code is ${checkInToken}.`,
      type: 'APPROVAL',
      link: '/my-bookings',
    },
  });

  return {
    status: PreemptionStatus.COMPLETED,
    requiresAdminConfirmation: false,
    preemptionRecord,
    updatedUrgent,
    updatedBumped,
    canUndoUntil: canUndoUntil.toISOString(),
    message: `Pre-emption successful. #${urgentBooking.bookingNumber} confirmed; #${bumpedBooking.bookingNumber} bumped to #1 priority on alternative waitlist.`,
  };
}

/**
 * Confirms or rejects a pending faculty pre-emption by an Administrator.
 */
export async function confirmFacultyPreemptionByAdmin(
  preemptionRecordId: string,
  adminUser: AuthenticatedUser,
  approved: boolean,
  adminNotes?: string
) {
  if (adminUser.role !== Role.ADMINISTRATOR) {
    throw new ApprovalError('Forbidden: Only Administrators can confirm faculty pre-emptions.', 403);
  }

  const now = new Date();

  return await prisma.$transaction(async (tx) => {
    const record = await tx.preemptionRecord.findUnique({
      where: { id: preemptionRecordId },
      include: {
        targetBooking: { include: { user: true, resource: true, department: true } },
        bumpedBooking: { include: { user: true, resource: true, department: true } },
        initiator: true,
      },
    });

    if (!record) {
      throw new ApprovalError('Preemption record not found.', 404);
    }

    if (record.status !== PreemptionStatus.PENDING_ADMIN_CONFIRMATION) {
      throw new ApprovalError(
        `Preemption record is in status ${record.status}, expected PENDING_ADMIN_CONFIRMATION.`,
        409
      );
    }

    if (!approved) {
      const updatedRecord = await tx.preemptionRecord.update({
        where: { id: record.id },
        data: {
          status: PreemptionStatus.REJECTED,
          adminApproverId: adminUser.id,
          adminConfirmedAt: now,
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          action: 'FACULTY_PREEMPTION_REJECTED',
          userId: adminUser.id,
          entityType: 'PreemptionRecord',
          entityId: record.id,
          details: `Admin ${adminUser.name} rejected faculty pre-emption of #${record.bumpedBooking.bookingNumber}. Notes: ${adminNotes || 'None'}`,
        },
      });

      // Notify Initiator
      await tx.notification.create({
        data: {
          userId: record.initiatorId,
          title: `Faculty Pre-emption Rejected by Admin`,
          message: `Your request to pre-empt faculty reservation #${record.bumpedBooking.bookingNumber} was declined by Admin ${adminUser.name}.`,
          type: 'APPROVAL',
          link: '/approvals',
        },
      });

      return {
        status: PreemptionStatus.REJECTED,
        message: 'Faculty pre-emption request was rejected by Administrator.',
      };
    }

    // If Approved, complete pre-emption transaction now
    const result = await completePreemptionTransaction({
      tx,
      urgentBooking: record.targetBooking,
      bumpedBooking: record.bumpedBooking,
      initiator: record.initiator as any,
      adminApprover: adminUser,
      reason: record.reason + (adminNotes ? ` (Admin notes: ${adminNotes})` : ''),
      now,
    });

    await tx.preemptionRecord.update({
      where: { id: record.id },
      data: {
        status: PreemptionStatus.COMPLETED,
        adminApproverId: adminUser.id,
        adminConfirmedAt: now,
        canUndoUntil: new Date(now.getTime() + 5 * 60000),
      },
    });

    return result;
  });
}

/**
 * Reverts / Undoes a pre-emption within the 5-minute safety window.
 * Strictly re-validates:
 * 1. Undo window has not elapsed.
 * 2. Bumped booking has not been checked in, cancelled, or altered.
 * 3. Restoring does not create double bookings or timetable conflicts.
 */
export async function undoPreemption(
  preemptionRecordId: string,
  user: AuthenticatedUser,
  undoReason: string
) {
  if (!undoReason || undoReason.trim().length < 5) {
    throw new ApprovalError('A valid reason of at least 5 characters is required for undo.', 400);
  }

  const now = new Date();

  return await prisma.$transaction(async (tx) => {
    const record = await tx.preemptionRecord.findUnique({
      where: { id: preemptionRecordId },
      include: {
        targetBooking: { include: { user: true, resource: true } },
        bumpedBooking: { include: { user: true, resource: true } },
      },
    });

    if (!record) {
      throw new ApprovalError('Preemption record not found.', 404);
    }

    if (record.status !== PreemptionStatus.COMPLETED) {
      throw new ApprovalError(
        `Cannot undo: Preemption record is currently in status ${record.status}.`,
        400
      );
    }

    // 1. Check 5-minute window
    if (!record.canUndoUntil || now > record.canUndoUntil) {
      throw new ApprovalError(
        'The 5-minute undo window for this pre-emption action has expired.',
        400
      );
    }

    // 2. Authorization check: Initiator or Admin
    if (record.initiatorId !== user.id && user.role !== Role.ADMINISTRATOR) {
      throw new ApprovalError('Forbidden: Only the original approver or an Administrator can undo this pre-emption.', 403);
    }

    // 3. Concurrency check on Target Booking (Urgent)
    if (record.targetBooking.status === BookingStatus.CHECKED_IN) {
      throw new ApprovalError(
        'Cannot undo pre-emption: The urgent booking has already checked in.',
        409
      );
    }

    // 4. Overlap & Conflict Check on Bumped Booking
    // Ensure no NEW confirmed booking was created during this interval that conflicts with bumped booking's slot
    const conflictBooking = await tx.booking.findFirst({
      where: {
        resourceId: record.bumpedBooking.resourceId,
        id: { notIn: [record.bumpedBookingId, record.targetBookingId] },
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.APPROVED] },
        startTime: { lt: record.bumpedBooking.endTime },
        endTime: { gt: record.bumpedBooking.startTime },
      },
    });

    if (conflictBooking) {
      throw new ApprovalError(
        `Cannot undo: A new confirmed reservation (#${conflictBooking.bookingNumber}) now occupies this time slot.`,
        409
      );
    }

    // 5. Reset Urgent Booking back to PENDING first
    // (Prevents PostgreSQL exclusion constraint violation `no_overlapping_confirmed_bookings`
    // when restoring the bumped booking to CONFIRMED on the same resource and overlapping slot)
    await tx.booking.update({
      where: { id: record.targetBookingId },
      data: {
        status: BookingStatus.PENDING,
        checkInToken: null,
        releaseDeadline: null,
        approvalNotes: `Pre-emption reversed. Booking returned to pending approval queue.`,
        decidedAt: null,
        decidedById: null,
      },
    });

    // 6. Restore Bumped Booking to original CONFIRMED state with token and release deadline
    const restoredToken = record.bumpedOriginalCheckInToken || crypto.randomInt(100000, 1000000).toString();
    const restoredDeadline = record.bumpedOriginalReleaseDeadline || new Date(record.bumpedBooking.startTime.getTime() + 15 * 60000);

    await tx.booking.update({
      where: { id: record.bumpedBookingId },
      data: {
        status: BookingStatus.CONFIRMED,
        checkInToken: restoredToken,
        releaseDeadline: restoredDeadline,
        rejectionReason: null,
        approvalNotes: `Pre-emption undone by ${user.name}. Restored to original confirmed status.`,
        decidedAt: now,
      },
    });

    // 7. Remove Waitlist entry created for bumped booking
    await tx.waitlistEntry.deleteMany({
      where: {
        bookingId: record.bumpedBookingId,
        resourceId: record.bumpedBooking.resourceId,
      },
    });

    // 8. Update PreemptionRecord to UNDONE
    await tx.preemptionRecord.update({
      where: { id: record.id },
      data: {
        status: PreemptionStatus.UNDONE,
        undoneAt: now,
        undoneById: user.id,
        undoReason: undoReason.trim(),
      },
    });

    // 9. Audit Logs
    await tx.auditLog.create({
      data: {
        action: 'PREEMPTION_UNDONE',
        userId: user.id,
        entityType: 'PreemptionRecord',
        entityId: record.id,
        details: `Pre-emption undone within safety window. Restored #${record.bumpedBooking.bookingNumber} to CONFIRMED and returned #${record.targetBooking.bookingNumber} to PENDING. Reason: ${undoReason}`,
      },
    });

    // 10. Notifications
    await tx.notification.create({
      data: {
        userId: record.bumpedBooking.userId,
        title: `Reservation Restored: #${record.bumpedBooking.bookingNumber}`,
        message: `Your reservation #${record.bumpedBooking.bookingNumber} on ${record.bumpedBooking.resource.name} has been restored to CONFIRMED. Your check-in code is ${restoredToken}.`,
        type: 'APPROVAL',
        link: '/my-bookings',
      },
    });

    await tx.notification.create({
      data: {
        userId: record.targetBooking.userId,
        title: `Pre-emption Reversed: #${record.targetBooking.bookingNumber}`,
        message: `Pre-emption for #${record.targetBooking.bookingNumber} was reversed. Your request has been returned to the pending review queue.`,
        type: 'APPROVAL',
        link: '/my-bookings',
      },
    });

    return {
      status: PreemptionStatus.UNDONE,
      message: `Pre-emption safely undone. #${record.bumpedBooking.bookingNumber} restored to CONFIRMED; #${record.targetBooking.bookingNumber} returned to PENDING.`,
    };
  });
}
