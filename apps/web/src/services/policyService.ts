import { BookingStatus, Role, PrismaClient } from '@prisma/client';
import { getKolkataWeekRange } from '@/lib/timezone';
import { QuotaResponse } from '@lpu/shared';

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  initialStatus: BookingStatus;
  reason?: string;
  autoReleaseMinutes: number;
  remainingWeeklyQuota?: number;
  maxWeeklyHours?: number;
  currentWeeklyHours?: number;
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
  additionalWeeklyHours?: number;
  seriesStartDate?: Date;
}

/**
 * Retrieves the remaining weekly quota and active booked hours for a user in Asia/Kolkata calendar week.
 */
export async function getWeeklyQuotaUsage({
  user,
  department,
  date,
  prisma,
  additionalHours = 0,
}: {
  user: { id: string; role: Role };
  department?: string;
  date: Date | string;
  prisma: any;
  additionalHours?: number;
}): Promise<{
  currentWeeklyHours: number;
  maxWeeklyHours: number;
  remainingWeeklyQuota: number;
  weekStartStr: string;
  weekEndStr: string;
  weekStartUtc: Date;
  weekEndUtc: Date;
  policyName: string;
}> {
  let maxWeeklyHours = 20;
  let policyName = 'Default Campus Student Quota (20h/week)';

  if (department) {
    const policy = await prisma.departmentPolicy.findUnique({
      where: { department },
    });
    if (policy?.maxBookingHoursPerWeek) {
      maxWeeklyHours = policy.maxBookingHoursPerWeek;
      policyName = `Department Quota: ${department} (${maxWeeklyHours}h/week)`;
    }
  }

  const { weekStartStr, weekEndStr, weekStartUtc, weekEndUtc } = getKolkataWeekRange(date);

  if (user.role !== Role.STUDENT) {
    return {
      currentWeeklyHours: 0,
      maxWeeklyHours: 999,
      remainingWeeklyQuota: 999,
      weekStartStr,
      weekEndStr,
      weekStartUtc,
      weekEndUtc,
      policyName: 'Unrestricted Quota (Faculty / Administrator)',
    };
  }

  const activeBookings = await prisma.booking.findMany({
    where: {
      userId: user.id,
      status: {
        in: [
          BookingStatus.PENDING,
          BookingStatus.APPROVED,
          BookingStatus.CONFIRMED,
          BookingStatus.CHECKED_IN,
          BookingStatus.COMPLETED,
        ],
      },
      startTime: { gte: weekStartUtc, lte: weekEndUtc },
    },
    select: {
      startTime: true,
      endTime: true,
    },
  });

  let currentWeeklyHours = 0;
  for (const b of activeBookings) {
    currentWeeklyHours += (b.endTime.getTime() - b.startTime.getTime()) / (1000 * 60 * 60);
  }

  currentWeeklyHours += additionalHours;

  const remainingWeeklyQuota = Math.max(0, parseFloat((maxWeeklyHours - currentWeeklyHours).toFixed(1)));
  return {
    currentWeeklyHours: parseFloat(currentWeeklyHours.toFixed(1)),
    maxWeeklyHours,
    remainingWeeklyQuota,
    weekStartStr,
    weekEndStr,
    weekStartUtc,
    weekEndUtc,
    policyName,
  };
}

/**
 * Returns complete quota response contract for GET /api/me/quota.
 */
export async function getAuthoritativeQuota({
  user,
  date,
  prisma,
}: {
  user: { id: string; role: Role; department?: string };
  date?: Date | string;
  prisma: any;
}): Promise<QuotaResponse> {
  const targetDate = date || new Date();
  const usage = await getWeeklyQuotaUsage({
    user,
    department: user.department,
    date: targetDate,
    prisma,
  });

  return {
    periodStart: usage.weekStartStr,
    periodEnd: usage.weekEndStr,
    currentWeeklyHours: usage.currentWeeklyHours,
    remainingWeeklyQuota: usage.remainingWeeklyQuota,
    maxWeeklyHours: usage.maxWeeklyHours,
    role: user.role,
    department: user.department || 'Campus Wide',
    policyName: usage.policyName,
    message:
      user.role === Role.STUDENT
        ? `${usage.remainingWeeklyQuota}h of ${usage.maxWeeklyHours}h remaining for the week of ${usage.weekStartStr} to ${usage.weekEndStr}.`
        : 'Faculty and Administrator accounts have unrestricted weekly reservation quota.',
  };
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
  additionalWeeklyHours = 0,
  seriesStartDate,
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

  // Compute user quota usage
  const quota = await getWeeklyQuotaUsage({
    user,
    department: resource.department,
    date: startTime,
    prisma,
    additionalHours: additionalWeeklyHours,
  });

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
            remainingWeeklyQuota: quota.remainingWeeklyQuota,
            maxWeeklyHours: quota.maxWeeklyHours,
            currentWeeklyHours: quota.currentWeeklyHours,
          };
        }
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  // 3. Maximum Advance Booking Days Validation
  // For recurring series, validate that the series starts within the advance booking window
  const checkDate = seriesStartDate || startTime;
  const maxFutureDate = new Date();
  maxFutureDate.setDate(maxFutureDate.getDate() + maxAdvanceDays);
  maxFutureDate.setHours(23, 59, 59, 999);

  if (checkDate > maxFutureDate) {
    return {
      allowed: false,
      requiresApproval: true,
      initialStatus: BookingStatus.REJECTED,
      reason: `Booking exceeds maximum advance reservation window of ${maxAdvanceDays} days for ${resource.department}.`,
      autoReleaseMinutes,
      remainingWeeklyQuota: quota.remainingWeeklyQuota,
      maxWeeklyHours: quota.maxWeeklyHours,
      currentWeeklyHours: quota.currentWeeklyHours,
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
        remainingWeeklyQuota: quota.remainingWeeklyQuota,
        maxWeeklyHours: quota.maxWeeklyHours,
        currentWeeklyHours: quota.currentWeeklyHours,
      };
    }
  }

  // 5. Weekly Booking Quota Validation (for Students)
  if (user.role === Role.STUDENT) {
    if (quota.currentWeeklyHours + durationHours > quota.maxWeeklyHours) {
      return {
        allowed: false,
        requiresApproval: true,
        initialStatus: BookingStatus.REJECTED,
        reason: `Weekly booking quota of ${quota.maxWeeklyHours} hours exceeded (currently reserved: ${quota.currentWeeklyHours.toFixed(1)}h, requested: ${durationHours.toFixed(1)}h).`,
        autoReleaseMinutes,
        remainingWeeklyQuota: quota.remainingWeeklyQuota,
        maxWeeklyHours: quota.maxWeeklyHours,
        currentWeeklyHours: quota.currentWeeklyHours,
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
      remainingWeeklyQuota: quota.remainingWeeklyQuota,
      maxWeeklyHours: quota.maxWeeklyHours,
      currentWeeklyHours: quota.currentWeeklyHours,
    };
  }

  // For Students:
  if (resource.requiresApproval) {
    return {
      allowed: true,
      requiresApproval: true,
      initialStatus: BookingStatus.PENDING,
      reason: 'This facility requires department approver review and approval before confirmation.',
      autoReleaseMinutes,
      remainingWeeklyQuota: quota.remainingWeeklyQuota,
      maxWeeklyHours: quota.maxWeeklyHours,
      currentWeeklyHours: quota.currentWeeklyHours,
    };
  }

  if (durationHours > autoApproveStudentHours) {
    return {
      allowed: true,
      requiresApproval: true,
      initialStatus: BookingStatus.PENDING,
      reason: `Bookings longer than ${autoApproveStudentHours} hours require department approver endorsement.`,
      autoReleaseMinutes,
      remainingWeeklyQuota: quota.remainingWeeklyQuota,
      maxWeeklyHours: quota.maxWeeklyHours,
      currentWeeklyHours: quota.currentWeeklyHours,
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
    initialStatus: BookingStatus.CONFIRMED,
    autoReleaseMinutes,
    remainingWeeklyQuota: quota.remainingWeeklyQuota,
    maxWeeklyHours: quota.maxWeeklyHours,
    currentWeeklyHours: quota.currentWeeklyHours,
  };
}
