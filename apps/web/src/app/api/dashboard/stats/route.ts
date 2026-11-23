import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { ok, withErrorHandling } from '@/lib/api-response';
import { BookingStatus, Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const now = new Date();

  // 1. Upcoming Bookings for user
  const upcomingBookingsCount = await prisma.booking.count({
    where: {
      userId: user.id,
      startTime: { gte: now },
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.CHECKED_IN] },
    },
  });

  // 2. Pending Requests
  let pendingRequestsCount = 0;
  if (user.role === Role.DEPARTMENT_APPROVER || user.role === Role.ADMINISTRATOR) {
    pendingRequestsCount = await prisma.booking.count({
      where: { status: BookingStatus.PENDING },
    });
  } else {
    pendingRequestsCount = await prisma.booking.count({
      where: {
        userId: user.id,
        status: BookingStatus.PENDING,
      },
    });
  }

  // 3. Available Resources across campus
  const availableResourcesCount = await prisma.resource.count({
    where: {
      isAvailableNow: true,
      isUnderMaintenance: false,
    },
  });

  // 4. Club / Organization bookings
  const clubBookingsCount = await prisma.booking.count({
    where: {
      userId: user.id,
      activityType: 'CLUB_EVENT',
    },
  });

  // 5. Next upcoming booking
  const nextBooking = await prisma.booking.findFirst({
    where: {
      userId: user.id,
      startTime: { gte: now },
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.CHECKED_IN] },
    },
    orderBy: { startTime: 'asc' },
    include: {
      resource: true,
    },
  });

  // 6. User's Upcoming Bookings List (up to 5)
  const upcomingList = await prisma.booking.findMany({
    where: {
      userId: user.id,
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.PENDING, BookingStatus.CHECKED_IN] },
    },
    orderBy: { startTime: 'asc' },
    take: 5,
    include: {
      resource: true,
    },
  });

  // 7. Recommended resources
  const recommendedResources = await prisma.resource.findMany({
    where: {
      isUnderMaintenance: false,
    },
    take: 4,
  });

  // 8. Weekly Schedule timetable for user
  const timetableClasses = await prisma.timetableEntry.findMany({
    include: { resource: true },
    take: 6,
  });

  return ok({
    stats: {
      upcomingBookingsCount,
      pendingRequestsCount,
      availableResourcesCount,
      clubBookingsCount,
      nextBooking,
    },
    upcomingBookings: upcomingList,
    recommendedResources,
    timetableClasses,
  });
});
