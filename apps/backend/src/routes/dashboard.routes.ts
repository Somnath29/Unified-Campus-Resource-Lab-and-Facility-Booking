import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { BookingStatus, Role } from '@prisma/client';

const router = Router();

// GET /api/dashboard/stats
router.get('/stats', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
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
      // For approvers/admins, count all pending requests awaiting review
      pendingRequestsCount = await prisma.booking.count({
        where: { status: BookingStatus.PENDING },
      });
    } else {
      // For students/faculty, count their own pending requests
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

    // 8. Weekly Schedule timetable for user (combining academic classes + user bookings)
    // Find timetable entries for user's department/classes
    const timetableClasses = await prisma.timetableEntry.findMany({
      include: { resource: true },
      take: 6,
    });

    return res.json({
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
  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
    return res.status(500).json({ error: 'Failed to retrieve dashboard statistics.' });
  }
});

export default router;

