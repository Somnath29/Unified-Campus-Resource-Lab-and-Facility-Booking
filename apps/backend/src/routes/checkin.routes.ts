import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { BookingStatus } from '@prisma/client';

const router = Router();

// POST /api/checkin/verify (QR code verification or 6-digit numeric PIN)
router.post('/verify', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { token, bookingId } = req.body;
    const user = req.user!;

    if (!token && !bookingId) {
      return res.status(400).json({ error: 'Please provide a valid QR check-in token or booking ID.' });
    }

    const where: any = {};
    if (token) where.checkInToken = String(token).trim();
    if (bookingId) where.id = String(bookingId);

    const booking = await prisma.booking.findFirst({
      where,
      include: { resource: true, user: true },
    });

    if (!booking) {
      return res.status(404).json({ error: 'No matching reservation found for this verification code.' });
    }

    if (booking.status === BookingStatus.CHECKED_IN) {
      return res.json({
        message: 'This reservation is already checked-in.',
        booking,
      });
    }

    if (booking.status === BookingStatus.NO_SHOW) {
      return res.status(400).json({
        error: 'This reservation has been marked as NO-SHOW and released due to elapsed check-in window.',
      });
    }

    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.REJECTED) {
      return res.status(400).json({
        error: `Cannot check in to a booking with status ${booking.status}.`,
      });
    }

    const now = new Date();
    // Allow check-in starting 30 minutes before booking start time up to release deadline
    const earliestCheckIn = new Date(booking.startTime.getTime() - 30 * 60000);

    if (now < earliestCheckIn) {
      return res.status(400).json({
        error: `Check-in opens 30 minutes prior to reservation start time (${booking.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).`,
      });
    }

    // Mark as Checked In
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CHECKED_IN,
        checkedInAt: now,
      },
      include: { resource: true, user: true },
    });

    // Notify user
    await prisma.notification.create({
      data: {
        userId: booking.userId,
        title: `Check-in Verified: ${booking.resource.name}`,
        message: `Welcome! Your check-in for ${booking.resource.name} is confirmed at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
        type: 'CHECKIN',
        link: '/my-bookings',
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'CHECKIN_COMPLETED',
        userId: user.id,
        entityType: 'Booking',
        entityId: booking.id,
        details: `Verified check-in for ${booking.resource.name} via ${token ? 'Token' : 'Direct'} verification`,
      },
    });

    return res.json({
      success: true,
      message: `Check-in successful! Resource ${booking.resource.name} is active for your session.`,
      booking: updated,
    });
  } catch (err) {
    console.error('Error during check-in:', err);
    return res.status(500).json({ error: 'Failed to process check-in.' });
  }
});

// POST /api/checkin/auto-release-scan (Core Business Logic: auto-release expired reservations)
router.post('/auto-release-scan', async (req: Request, res: Response) => {
  try {
    const now = new Date();

    // Find confirmed bookings whose releaseDeadline has elapsed without check-in
    const expiredBookings = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        releaseDeadline: { lt: now },
        checkedInAt: null,
      },
      include: { resource: true, user: true },
    });

    const releasedList: string[] = [];

    for (const b of expiredBookings) {
      await prisma.booking.update({
        where: { id: b.id },
        data: {
          status: BookingStatus.NO_SHOW,
          approvalNotes: `Auto-released by system at ${now.toLocaleTimeString()}: user failed to check in within 15 minutes.`,
        },
      });

      // Notify the student/faculty
      await prisma.notification.create({
        data: {
          userId: b.userId,
          title: `Booking Released (No-Show): ${b.resource.name}`,
          message: `Your booking #${b.bookingNumber} was automatically cancelled and released to other students because you missed the 15-minute check-in deadline.`,
          type: 'CHECKIN',
          link: '/my-bookings',
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          action: 'AUTOMATIC_RESOURCE_RELEASE',
          entityType: 'Booking',
          entityId: b.id,
          details: `Resource ${b.resource.name} released automatically due to no-show by ${b.user.name}`,
        },
      });

      releasedList.push(b.bookingNumber);
    }

    return res.json({
      success: true,
      timestamp: now.toISOString(),
      releasedCount: releasedList.length,
      releasedBookings: releasedList,
    });
  } catch (err) {
    console.error('Error running auto-release scan:', err);
    return res.status(500).json({ error: 'Failed to execute auto-release scan.' });
  }
});

export default router;

