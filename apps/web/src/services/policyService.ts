import { BookingStatus, Role, PrismaClient } from '@prisma/client';

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  initialStatus: BookingStatus;
  reason?: string;
  autoReleaseMinutes: number;
}

export interface EvaluatePolicyParams {
  user: {
    id: string;
    role: Role;
    department: string;
  };
  resource: {
    id: string;
    name: string;
    department: string;
    category: string;
    requiresApproval: boolean;
    capacity: number;
  };
  startTime: Date;
  endTime: Date;
  prisma: any; // PrismaClient or TransactionClient
}

/**
 * Calculates start (Monday 00:00:00) and end (Sunday 23:59:59) of the calendar week for a given date in UTC.
 */
function getWeekRange(date: Date): { weekStart: Date; weekEnd: Date } {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  return { weekStart: monday, weekEnd: sunday };
}

/**
 * Centralized A7 Policy Evaluation Engine.
 */
export async function evaluateBookingPolicy({
  user,
  resource,
  startTime,
  endTime,
  prisma,
}: EvaluatePolicyParams): Promise<PolicyDecision> {
  // 1. Fetch Department Policy
  const policy = await prisma.departmentPolicy.findUnique({
    where: { department: resource.department },
  });

  const maxAdvanceDays = policy?.maxAdvanceDays ?? 14;
  const maxWeeklyHours = policy?.maxBookingHoursPerWeek ?? 20;
  const autoApproveStudentHours = policy?.autoApproveStudentHours ?? 2;
  const autoReleaseMinutes = policy?.autoReleaseMinutes ?? 15;

  const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

  // 2. Blackout Periods Validation
  if (policy?.blackoutPeriods) {
    try {
      const blackouts = JSON.parse(policy.blackoutPeriods) as Array<{
        start: string;
        end: string;
        reason?: string;
      }>;

      for (const b of blackouts) {
        const bStart = new Date(b.start);
        const bEnd = new Date(b.end);
        if (startTime < bEnd && endTime > bStart) {
          return {
            allowed: false,
            requiresApproval: true,
            initialStatus: BookingStatus.REJECTED,
            reason: `Requested time slot overlaps department blackout period: ${b.reason || 'Scheduled maintenance/event'}.`,
            autoReleaseMinutes,
          };
        }
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  // 3. Maximum Advance Booking Days Validation
  const maxFutureDate = new Date();
  maxFutureDate.setDate(maxFutureDate.getDate() + maxAdvanceDays);
  maxFutureDate.setHours(23, 59, 59, 999);

  if (startTime > maxFutureDate) {
    return {
      allowed: false,
      requiresApproval: true,
      initialStatus: BookingStatus.REJECTED,
      reason: `Booking exceeds maximum advance reservation window of ${maxAdvanceDays} days for ${resource.department}.`,
      autoReleaseMinutes,
    };
  }

  // 4. No-Show Restrictions Check (for Students)
  if (user.role === Role.STUDENT) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const noShowCount = await prisma.booking.count({
      where: {
        userId: user.id,
        status: BookingStatus.NO_SHOW,
        updatedAt: { gte: thirtyDaysAgo },
      },
    });

    if (noShowCount >= 3) {
      return {
        allowed: false,
        requiresApproval: true,
        initialStatus: BookingStatus.REJECTED,
        reason:
          'Booking privileges are temporarily restricted due to 3 or more unexcused no-shows in the past 30 days.',
        autoReleaseMinutes,
      };
    }
  }

  // 5. Weekly Booking Quota Validation (for Students)
  if (user.role === Role.STUDENT) {
    const { weekStart, weekEnd } = getWeekRange(startTime);
    const activeBookings = await prisma.booking.findMany({
      where: {
        userId: user.id,
        status: {
          in: [
            BookingStatus.PENDING,
            BookingStatus.APPROVED,
            BookingStatus.CONFIRMED,
            BookingStatus.CHECKED_IN,
          ],
        },
        startTime: { gte: weekStart, lte: weekEnd },
      },
      select: {
        startTime: true,
        endTime: true,
      },
    });

    let currentWeekHours = 0;
    for (const b of activeBookings) {
      currentWeekHours += (b.endTime.getTime() - b.startTime.getTime()) / (1000 * 60 * 60);
    }

    if (currentWeekHours + durationHours > maxWeeklyHours) {
      return {
        allowed: false,
        requiresApproval: true,
        initialStatus: BookingStatus.REJECTED,
        reason: `Weekly booking quota of ${maxWeeklyHours} hours exceeded (currently reserved: ${currentWeekHours.toFixed(1)}h, requested: ${durationHours.toFixed(1)}h).`,
        autoReleaseMinutes,
      };
    }
  }

  // 6. Approval vs Auto-Confirmation Determination
  if (user.role === Role.ADMINISTRATOR || user.role === Role.FACULTY) {
    return {
      allowed: true,
      requiresApproval: false,
      initialStatus: BookingStatus.CONFIRMED,
      autoReleaseMinutes,
    };
  }

  // For Students:
  if (resource.requiresApproval) {
    return {
      allowed: true,
      requiresApproval: true,
      initialStatus: BookingStatus.PENDING,
      autoReleaseMinutes,
    };
  }

  if (durationHours > autoApproveStudentHours) {
    return {
      allowed: true,
      requiresApproval: true,
      initialStatus: BookingStatus.PENDING,
      reason: `Bookings longer than ${autoApproveStudentHours} hours require department approver endorsement.`,
      autoReleaseMinutes,
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
    initialStatus: BookingStatus.CONFIRMED,
    autoReleaseMinutes,
  };
}
