import { prisma } from '../lib/prisma';
import { BookingStatus, Role, ActivityType } from '@prisma/client';
import { AuthenticatedUser } from '../middleware/auth';
import { ApprovalError, getAuthorizedDepartmentIds } from './approvalService';

// In-memory cache for insights results (60 seconds TTL)
interface CacheEntry {
  data: any;
  expiresAt: number;
}

const insightsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

export function clearInsightsCache() {
  insightsCache.clear();
}

/**
 * Calculates operating hours per day from an operatingHours string like "08:00 AM - 08:00 PM".
 * Defaults to 12 if unspecified or custom text.
 */
function parseDailyOperatingHours(operatingHours?: string): number {
  if (!operatingHours) return 12;
  try {
    const parts = operatingHours.split('-').map((s) => s.trim());
    if (parts.length !== 2) return 12;

    const parseTime = (timeStr: string) => {
      const [time, modifier] = timeStr.split(' ');
      let [hours, minutes] = time.split(':').map(Number);
      if (modifier === 'PM' && hours < 12) hours += 12;
      if (modifier === 'AM' && hours === 12) hours = 0;
      return hours + (minutes || 0) / 60;
    };

    const openHour = parseTime(parts[0]);
    const closeHour = parseTime(parts[1]);
    const duration = closeHour - openHour;
    return duration > 0 && duration <= 24 ? duration : 12;
  } catch {
    return 12;
  }
}

export interface InsightsParams {
  startDate?: string;
  endDate?: string;
  idleThresholdHours?: number; // threshold in hours or percent to flag idle resources (default: 5 hours or < 20% utilisation)
}

/**
 * Calculates Department Utilisation Insights (Task P9).
 * Scoped strictly to the approver's authorized departments.
 * Cached for 60 seconds.
 */
export async function getDepartmentInsights(
  user: AuthenticatedUser,
  params: InsightsParams
) {
  const authorizedDeptIds = await getAuthorizedDepartmentIds(user);

  // If approver has no department assigned, fail with 403 or empty
  if (authorizedDeptIds !== null && authorizedDeptIds.length === 0) {
    throw new ApprovalError('You are not authorized for any department insights.', 403);
  }

  // Parse Date Range (normalize without sub-millisecond drift if empty)
  const now = new Date();
  const start = params.startDate ? new Date(params.startDate) : new Date(Math.floor(now.getTime() / 60000) * 60000 - 30 * 86400000);
  const end = params.endDate ? new Date(params.endDate) : new Date(Math.floor(now.getTime() / 60000) * 60000);

  // Build Cache Key
  const deptKey = authorizedDeptIds === null ? 'ALL' : authorizedDeptIds.sort().join(',');
  const cacheKey = `${user.id}:${deptKey}:${start.toISOString()}:${end.toISOString()}:${params.idleThresholdHours || 5}`;

  const cached = insightsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  // 1. Fetch relevant departments & resources
  const resourceWhere: any = {};
  if (authorizedDeptIds !== null) {
    resourceWhere.OR = [
      { departmentId: { in: authorizedDeptIds } },
    ];
  }

  const resources = await prisma.resource.findMany({
    where: resourceWhere,
    include: {
      departmentRel: true,
    },
    orderBy: { name: 'asc' },
  });

  const resourceIds = resources.map((r) => r.id);

  // 2. Fetch all bookings for these resources in the time range
  const bookings = await prisma.booking.findMany({
    where: {
      resourceId: { in: resourceIds },
      startTime: { gte: start, lte: end },
    },
    include: {
      resource: true,
      user: {
        select: { id: true, name: true, email: true, role: true, department: true },
      },
      approvalDecisions: true,
    },
    orderBy: { startTime: 'asc' },
  });

  // 3. Utilisation per resource
  // Calculate total booked hours and percentage based on standard 12 hours/day (08:00 to 20:00) operating window
  const daysDiff = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  const maxPossibleOperatingHoursPerResource = daysDiff * 12;

  const resourceStatsMap = new Map<string, {
    resourceId: string;
    resourceName: string;
    resourceCode: string;
    category: string;
    department: string;
    building: string;
    capacity: number;
    totalBookings: number;
    confirmedBookings: number;
    checkedInBookings: number;
    noShowBookings: number;
    totalBookedHours: number;
    utilizationRate: number; // percentage
  }>();

  resources.forEach((r) => {
    resourceStatsMap.set(r.id, {
      resourceId: r.id,
      resourceName: r.name,
      resourceCode: r.code,
      category: r.category,
      department: r.department,
      building: r.building,
      capacity: r.capacity,
      totalBookings: 0,
      confirmedBookings: 0,
      checkedInBookings: 0,
      noShowBookings: 0,
      totalBookedHours: 0,
      utilizationRate: 0,
    });
  });

  bookings.forEach((b) => {
    const stat = resourceStatsMap.get(b.resourceId);
    if (!stat) return;

    stat.totalBookings += 1;
    if (b.status === BookingStatus.CONFIRMED) stat.confirmedBookings += 1;
    if (b.status === BookingStatus.CHECKED_IN || b.status === BookingStatus.COMPLETED) {
      stat.checkedInBookings += 1;
    }
    if (b.status === BookingStatus.NO_SHOW) stat.noShowBookings += 1;

    // Count confirmed, checked in, or completed bookings toward utilisation
    if (([BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED, BookingStatus.NO_SHOW] as BookingStatus[]).includes(b.status)) {
      const durHours = (b.endTime.getTime() - b.startTime.getTime()) / 3600000;
      stat.totalBookedHours += Math.max(0, durHours);
    }
  });

  const resourceMap = new Map<string, any>();
  resources.forEach((r) => resourceMap.set(r.id, r));

  const resourceUtilisation = Array.from(resourceStatsMap.values()).map((stat) => {
    const resObj = resourceMap.get(stat.resourceId);
    const dailyHours = parseDailyOperatingHours(resObj?.operatingHours);
    const maxResourceOperatingHours = daysDiff * dailyHours;
    const rate = Math.min(100, Math.round((stat.totalBookedHours / maxResourceOperatingHours) * 100));
    return {
      ...stat,
      totalBookedHours: Math.round(stat.totalBookedHours * 10) / 10,
      utilizationRate: rate,
    };
  });

  // 4. Idle resources below a threshold (default: total booked hours <= 5 OR utilisation < 20%)
  const thresholdHours = params.idleThresholdHours ?? 5;
  const idleResources = resourceUtilisation
    .filter((r) => r.totalBookedHours <= thresholdHours || r.utilizationRate < 20)
    .sort((a, b) => a.utilizationRate - b.utilizationRate);

  // 5. No-show rate and repeat no-show requesters
  const nonPendingBookings = bookings.filter((b) => b.status !== BookingStatus.PENDING && b.status !== BookingStatus.CANCELLED);
  const totalNoShows = bookings.filter((b) => b.status === BookingStatus.NO_SHOW).length;
  const noShowRate = nonPendingBookings.length > 0
    ? Math.round((totalNoShows / nonPendingBookings.length) * 100)
    : 0;

  // Track no-shows by user
  const userNoShowMap = new Map<string, {
    user: any;
    noShowCount: number;
    totalBookings: number;
    lastNoShowAt?: Date;
    recentBookings: string[];
  }>();

  bookings.forEach((b) => {
    if (!userNoShowMap.has(b.userId)) {
      userNoShowMap.set(b.userId, {
        user: b.user,
        noShowCount: 0,
        totalBookings: 0,
        recentBookings: [],
      });
    }
    const userStat = userNoShowMap.get(b.userId)!;
    userStat.totalBookings += 1;

    if (b.status === BookingStatus.NO_SHOW) {
      userStat.noShowCount += 1;
      if (!userStat.lastNoShowAt || b.startTime > userStat.lastNoShowAt) {
        userStat.lastNoShowAt = b.startTime;
      }
      userStat.recentBookings.push(b.bookingNumber);
    }
  });

  // Repeat no-show requesters: users with >= 2 no-shows
  const repeatNoShowRequesters = Array.from(userNoShowMap.values())
    .filter((u) => u.noShowCount >= 2)
    .map((u) => ({
      userId: u.user.id,
      name: u.user.name,
      email: u.user.email,
      role: u.user.role,
      department: u.user.department,
      noShowCount: u.noShowCount,
      totalBookings: u.totalBookings,
      noShowRate: Math.round((u.noShowCount / u.totalBookings) * 100),
      lastNoShowAt: u.lastNoShowAt?.toISOString() || null,
      recentNoShowBookings: u.recentBookings.slice(0, 3),
    }))
    .sort((a, b) => b.noShowCount - a.noShowCount);

  // 6. Peak usage hours (08:00 to 20:00)
  const hourCounts = new Array(24).fill(0);
  bookings
    .filter((b) => ([BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED] as BookingStatus[]).includes(b.status))
    .forEach((b) => {
      const startH = b.startTime.getHours();
      const endH = b.endTime.getHours();
      for (let h = startH; h <= endH && h < 24; h++) {
        hourCounts[h] += 1;
      }
    });

  const peakUsageHours = [];
  for (let h = 8; h <= 20; h++) {
    const formattedHour = `${h.toString().padStart(2, '0')}:00`;
    peakUsageHours.push({
      hour: formattedHour,
      bookingsCount: hourCounts[h] || 0,
    });
  }

  // 7. Quota usage by user group / role (FACULTY, STUDENT)
  const quotaUsageByRole: Record<string, { totalHours: number; bookingsCount: number; userCount: Set<string> }> = {
    STUDENT: { totalHours: 0, bookingsCount: 0, userCount: new Set() },
    FACULTY: { totalHours: 0, bookingsCount: 0, userCount: new Set() },
    DEPARTMENT_APPROVER: { totalHours: 0, bookingsCount: 0, userCount: new Set() },
    ADMINISTRATOR: { totalHours: 0, bookingsCount: 0, userCount: new Set() },
  };

  bookings
    .filter((b) => ([BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED, BookingStatus.NO_SHOW] as BookingStatus[]).includes(b.status))
    .forEach((b) => {
      const role = b.user?.role || 'STUDENT';
      if (!quotaUsageByRole[role]) {
        quotaUsageByRole[role] = { totalHours: 0, bookingsCount: 0, userCount: new Set() };
      }
      const durHours = (b.endTime.getTime() - b.startTime.getTime()) / 3600000;
      quotaUsageByRole[role].totalHours += Math.max(0, durHours);
      quotaUsageByRole[role].bookingsCount += 1;
      quotaUsageByRole[role].userCount.add(b.userId);
    });

  // Fetch Department Policies for weekly quota comparison
  const departmentPolicies = await prisma.departmentPolicy.findMany({
    where: authorizedDeptIds !== null
      ? {
          OR: [
            { departmentId: { in: authorizedDeptIds } },
            { department: { in: resources.map((r) => r.department) } },
          ],
        }
      : {},
  });

  // Calculate average configured weekly quota (maxBookingHoursPerWeek, default: 20)
  const configuredWeeklyQuotaHours = departmentPolicies.length > 0
    ? Math.round(
        departmentPolicies.reduce((acc, p) => acc + (p.maxBookingHoursPerWeek || 20), 0) /
          departmentPolicies.length
      )
    : 20;

  const quotaUsage = Object.entries(quotaUsageByRole).map(([role, data]) => {
    const avgUserHours = data.userCount.size > 0 ? Math.round((data.totalHours / data.userCount.size) * 10) / 10 : 0;
    // Scale quota to date range window (configuredWeeklyQuotaHours * (daysDiff / 7))
    const windowQuotaHours = Math.round(configuredWeeklyQuotaHours * (daysDiff / 7) * 10) / 10;
    const quotaUtilisationPercent = windowQuotaHours > 0 ? Math.round((avgUserHours / windowQuotaHours) * 100) : 0;

    return {
      role,
      totalHours: Math.round(data.totalHours * 10) / 10,
      bookingsCount: data.bookingsCount,
      uniqueUsers: data.userCount.size,
      avgHoursPerUser: avgUserHours,
      configuredWeeklyQuotaHours,
      windowQuotaHours,
      quotaUtilisationPercent,
    };
  });

  // 8. Decision metrics: Average decision time & Approve-to-Reject ratio
  const decidedBookings = bookings.filter((b) => b.decidedAt !== null && b.submittedAt !== null);
  let totalDecisionTimeMinutes = 0;
  let approvedCount = 0;
  let rejectedCount = 0;

  decidedBookings.forEach((b) => {
    const diffMs = b.decidedAt!.getTime() - b.submittedAt.getTime();
    totalDecisionTimeMinutes += Math.max(0, diffMs / 60000);

    if (b.status === BookingStatus.APPROVED || b.status === BookingStatus.CONFIRMED || b.status === BookingStatus.CHECKED_IN || b.status === BookingStatus.COMPLETED || b.status === BookingStatus.NO_SHOW) {
      approvedCount += 1;
    } else if (b.status === BookingStatus.REJECTED) {
      rejectedCount += 1;
    }
  });

  // Also include any ApprovalDecisions recorded
  const decisions = await prisma.approvalDecision.findMany({
    where: {
      booking: { resourceId: { in: resourceIds } },
      createdAt: { gte: start, lte: end },
    },
  });

  decisions.forEach((d) => {
    if (d.action === 'APPROVE') approvedCount = Math.max(approvedCount, approvedCount + 1);
    if (d.action === 'REJECT') rejectedCount = Math.max(rejectedCount, rejectedCount + 1);
  });

  const averageDecisionTimeMinutes = decidedBookings.length > 0
    ? Math.round((totalDecisionTimeMinutes / decidedBookings.length) * 10) / 10
    : 0;

  const totalDecisions = approvedCount + rejectedCount;
  const approveToRejectRatio = {
    approved: approvedCount,
    rejected: rejectedCount,
    total: totalDecisions,
    approvalRate: totalDecisions > 0 ? Math.round((approvedCount / totalDecisions) * 100) : 100,
    rejectionRate: totalDecisions > 0 ? Math.round((rejectedCount / totalDecisions) * 100) : 0,
    ratioString: rejectedCount > 0 ? `${(approvedCount / rejectedCount).toFixed(1)} : 1` : `${approvedCount} : 0`,
  };

  // 9. Suggested Actions (e.g. idle resources or frequent no-show interventions)
  const suggestedActions: Array<{
    id: string;
    type: 'IDLE_RESOURCE' | 'REPEAT_NO_SHOW' | 'POLICY_OPTIMIZATION';
    title: string;
    description: string;
    suggestedPolicyChange: string;
    resourceId?: string;
    department?: string;
  }> = [];

  idleResources.slice(0, 3).forEach((ir) => {
    suggestedActions.push({
      id: `idle-${ir.resourceId}`,
      type: 'IDLE_RESOURCE',
      title: `Low Utilisation Alert: ${ir.resourceName}`,
      description: `${ir.resourceName} (${ir.department}) is utilised at only ${ir.utilizationRate}% with ${ir.totalBookedHours} total hours booked across ${daysDiff} days.`,
      suggestedPolicyChange: `Open ${ir.resourceName} for student self-study or reduce advance approval requirement to increase weekday afternoon utilisation.`,
      resourceId: ir.resourceId,
      department: ir.department,
    });
  });

  if (repeatNoShowRequesters.length > 0) {
    const topRepeat = repeatNoShowRequesters[0];
    suggestedActions.push({
      id: `repeat-noshow-${topRepeat.userId}`,
      type: 'REPEAT_NO_SHOW',
      title: `Repeat No-Show Action: ${topRepeat.name}`,
      description: `${topRepeat.name} has ${topRepeat.noShowCount} unverified no-shows (${topRepeat.noShowRate}% rate).`,
      suggestedPolicyChange: `Reduce weekly booking quota for repeat no-show offenders or require faculty endorsement for future reservations.`,
      department: topRepeat.department,
    });
  }

  const result = {
    summary: {
      totalResources: resources.length,
      totalBookings: bookings.length,
      noShowRate,
      totalNoShows,
      averageDecisionTimeMinutes,
      approvalRate: approveToRejectRatio.approvalRate,
      idleResourcesCount: idleResources.length,
    },
    resourceUtilisation,
    idleResources,
    noShowMetrics: {
      noShowRate,
      totalNoShows,
      repeatNoShowRequesters,
    },
    peakUsageHours,
    quotaUsage,
    decisionMetrics: {
      averageDecisionTimeMinutes,
      averageDecisionTimeHours: Math.round((averageDecisionTimeMinutes / 60) * 10) / 10,
      approveToRejectRatio,
    },
    suggestedActions,
    timeRange: {
      start: start.toISOString(),
      end: end.toISOString(),
      days: daysDiff,
    },
  };

  // Cache in memory for 60 seconds
  insightsCache.set(cacheKey, {
    data: result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return { ...result, cached: false };
}

/**
 * Sends a Policy Change Request to administrators.
 */
export async function sendPolicyChangeRequest(
  approver: AuthenticatedUser,
  payload: {
    department: string;
    resourceId?: string;
    subject: string;
    details: string;
    suggestedPolicy: string;
  }
) {
  if (!payload.subject || !payload.details) {
    throw new ApprovalError('Subject and details are required for policy-change requests.', 400);
  }

  // 1. Audit Log
  const audit = await prisma.auditLog.create({
    data: {
      action: 'POLICY_CHANGE_REQUESTED',
      userId: approver.id,
      entityType: 'DepartmentPolicy',
      entityId: payload.resourceId || payload.department,
      details: `${approver.name} requested policy modification for ${payload.department}: "${payload.subject}". Proposed: ${payload.suggestedPolicy}`,
    },
  });

  // 2. Notify Administrators
  const administrators = await prisma.user.findMany({
    where: { role: Role.ADMINISTRATOR },
    select: { id: true, email: true, name: true },
  });

  for (const admin of administrators) {
    await prisma.notification.create({
      data: {
        userId: admin.id,
        title: `Policy Change Request: ${payload.department}`,
        message: `${approver.name} proposed a policy adjustment: "${payload.subject}" (${payload.details})`,
        type: 'SYSTEM',
        link: '/admin',
      },
    });
  }

  return {
    success: true,
    requestId: audit.id,
    message: 'Policy-change request successfully delivered to university administrators.',
  };
}

/**
 * Adds an internal note against a repeat no-show requester.
 * Recorded as an internal note on their most recent no-show booking or system audit log,
 * strictly shielded from the student.
 */
export async function addNoShowInternalNote(
  approver: AuthenticatedUser,
  payload: {
    targetUserId: string;
    note: string;
  }
) {
  if (!payload.note || payload.note.trim().length === 0) {
    throw new ApprovalError('Note cannot be empty.', 400);
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: payload.targetUserId },
    select: { id: true, name: true, email: true },
  });

  if (!targetUser) {
    throw new ApprovalError('Target user not found.', 404);
  }

  // Find their most recent no-show booking if available
  const recentNoShow = await prisma.booking.findFirst({
    where: {
      userId: payload.targetUserId,
      status: BookingStatus.NO_SHOW,
    },
    orderBy: { startTime: 'desc' },
  });

  // Create an internal BookingComment on that booking if it exists
  if (recentNoShow) {
    await prisma.bookingComment.create({
      data: {
        bookingId: recentNoShow.id,
        authorId: approver.id,
        body: `[APPROVER INTERNAL NOTE ON REPEAT NO-SHOW]: ${payload.note.trim()}`,
        isInternal: true,
      },
    });
  }

  // Log in AuditLog
  await prisma.auditLog.create({
    data: {
      action: 'NO_SHOW_NOTE_RECORDED',
      userId: approver.id,
      entityType: 'User',
      entityId: targetUser.id,
      details: `Internal approver note recorded against repeat no-show requester ${targetUser.name}: "${payload.note.trim()}"`,
    },
  });

  return {
    success: true,
    message: `Internal warning note recorded for ${targetUser.name}.`,
  };
}
