import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { ok, withErrorHandling } from '@/lib/api-response';
import { BookingStatus, Role } from '@prisma/client';
import { getWeeklyQuotaUsage } from '@/services/policyService';
import { getDayOfWeekInKolkata, getCurrentKolkataDateString, kolkataToUtc } from '@/lib/timezone';
import { DashboardDataResponse } from '@lpu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const now = new Date();
  const todayStr = getCurrentKolkataDateString();
  const todayStartUtc = kolkataToUtc(todayStr, '00:00');
  const dayOfWeekToday = getDayOfWeekInKolkata(now);

  // 1. User-specific booking counts
  const [
    totalBookings,
    upcomingBookingsCount,
    completedBookingsCount,
    pendingRequestsCount,
    cancelledBookingsCount,
    availableResourcesCount,
    clubBookingsCount,
  ] = await Promise.all([
    prisma.booking.count({
      where: { userId: user.id },
    }),
    prisma.booking.count({
      where: {
        userId: user.id,
        startTime: { gte: now },
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.CHECKED_IN, BookingStatus.PENDING] },
      },
    }),
    prisma.booking.count({
      where: {
        userId: user.id,
        status: BookingStatus.COMPLETED,
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
        status: { in: [BookingStatus.CANCELLED, BookingStatus.REJECTED] },
      },
    }),
    prisma.resource.count({
      where: {
        deletedAt: null,
        isUnderMaintenance: false,
      },
    }),
    prisma.booking.count({
      where: {
        userId: user.id,
        activityType: 'CLUB_EVENT',
      },
    }),
  ]);

  // 2. Weekly Quota usage derived from A7 policy logic
  const quota = await getWeeklyQuotaUsage({
    user,
    department: user.department,
    date: now,
    prisma,
  });

  // 3. User's Upcoming Bookings List (up to 5, strictly private to authenticated user)
  const upcomingList = await prisma.booking.findMany({
    where: {
      userId: user.id,
      status: {
        in: [
          BookingStatus.CONFIRMED,
          BookingStatus.APPROVED,
          BookingStatus.PENDING,
          BookingStatus.CHECKED_IN,
        ],
      },
    },
    orderBy: { startTime: 'asc' },
    take: 6,
    include: {
      resource: true,
    },
  });

  // 4. User's Recent Activity (from AuditLog where user performed actions)
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      userId: user.id,
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  const recentActivity = auditLogs.map((log) => {
    let parsedDetails: any = null;
    try {
      parsedDetails = log.details ? JSON.parse(log.details) : null;
    } catch {}

    return {
      id: log.id,
      action: log.action,
      createdAt: log.createdAt.toISOString(),
      details: log.details,
      booking: parsedDetails
        ? {
            bookingNumber: parsedDetails.bookingNumber || '',
            resourceName: parsedDetails.resourceName || '',
          }
        : undefined,
    };
  });

  // 5. Recommended Resources (Active campus facilities)
  const recommendedResources = await prisma.resource.findMany({
    where: {
      deletedAt: null,
      isUnderMaintenance: false,
    },
    take: 4,
  });

  // 6. Timetable Classes (Filtered by day of week)
  const timetableClasses = await prisma.timetableEntry.findMany({
    where: {
      dayOfWeek: dayOfWeekToday,
    },
    include: { resource: true },
    take: 8,
    orderBy: { startTime: 'asc' },
  });

  const response: DashboardDataResponse = {
    stats: {
      totalBookings,
      upcomingBookingsCount,
      completedBookingsCount,
      pendingRequestsCount,
      cancelledBookingsCount,
      availableResourcesCount,
      clubBookingsCount,
      remainingWeeklyQuota: quota.remainingWeeklyQuota,
      maxWeeklyHours: quota.maxWeeklyHours,
      currentWeeklyHours: quota.currentWeeklyHours,
    },
    upcomingBookings: upcomingList.map((b) => ({
      ...b,
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
      resource: b.resource
        ? {
            ...b.resource,
            createdAt: b.resource.createdAt.toISOString(),
          }
        : undefined,
    })) as any,
    recentActivity,
    recommendedResources: recommendedResources.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })) as any,
    timetableClasses,
  };

  return ok(response);
});
