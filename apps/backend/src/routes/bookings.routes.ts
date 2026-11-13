import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { BookingStatus, ActivityType, PriorityLevel, Role } from '@prisma/client';

const router = Router();

const createBookingSchema = z.object({
  resourceId: z.string().uuid(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  purpose: z.string().min(5, 'Purpose must be at least 5 characters'),
  activityType: z.nativeEnum(ActivityType).default(ActivityType.PROJECT_WORK),
  expectedAttendance: z.number().int().positive().default(1),
  priority: z.nativeEnum(PriorityLevel).default(PriorityLevel.NORMAL),
});

// GET /api/bookings
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { status, resourceId, upcomingOnly } = req.query;

    const where: any = {};

    // Standard users only see their own bookings unless they are approver or admin
    if (user.role === Role.STUDENT || user.role === Role.FACULTY) {
      where.userId = user.id;
    } else if (req.query.myOnly === 'true') {
      where.userId = user.id;
    }

    if (status) {
      where.status = status as BookingStatus;
    }

    if (resourceId) {
      where.resourceId = String(resourceId);
    }

    if (upcomingOnly === 'true') {
      where.endTime = { gte: new Date() };
    }

    const bookings = await prisma.booking.findMany({
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

    return res.json({ bookings });
  } catch (err) {
    console.error('Error fetching bookings:', err);
    return res.status(500).json({ error: 'Failed to retrieve bookings.' });
  }
});

// GET /api/bookings/:id
router.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;

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
          },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    // Permission check
    if (
      user.role === Role.STUDENT &&
      booking.userId !== user.id
    ) {
      return res.status(403).json({ error: 'Unauthorized to view this booking.' });
    }

    return res.json({ booking });
  } catch (err) {
    console.error('Error fetching booking detail:', err);
    return res.status(500).json({ error: 'Failed to retrieve booking details.' });
  }
});

// POST /api/bookings (Create booking with double-booking prevention & timetable validation)
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const data = createBookingSchema.parse(req.body);

    const start = new Date(data.startTime);
    const end = new Date(data.endTime);

    if (end <= start) {
      return res.status(400).json({ error: 'End time must be after start time.' });
    }

    const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    if (durationHours > 8) {
      return res.status(400).json({ error: 'Maximum single booking duration is 8 hours.' });
    }

    // 1. Check Resource Exists and is not under maintenance
    const resource = await prisma.resource.findUnique({
      where: { id: data.resourceId },
    });

    if (!resource) {
      return res.status(404).json({ error: 'Selected resource does not exist.' });
    }

    if (resource.isUnderMaintenance) {
      return res.status(400).json({
        error: `Resource is temporarily blocked for maintenance: ${resource.maintenanceReason || 'Scheduled upkeep'}.`,
      });
    }

    if (data.expectedAttendance > resource.capacity) {
      return res.status(400).json({
        error: `Expected attendance (${data.expectedAttendance}) exceeds maximum capacity of ${resource.capacity}.`,
      });
    }

    // 2. Double-Booking Prevention: Check overlapping bookings
    const overlappingBookings = await prisma.booking.findMany({
      where: {
        resourceId: data.resourceId,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.CHECKED_IN, BookingStatus.PENDING] },
        AND: [
          { startTime: { lt: end } },
          { endTime: { gt: start } },
        ],
      },
    });

    if (overlappingBookings.length > 0) {
      return res.status(409).json({
        error: 'Slot conflict: The selected resource is already booked or reserved during this time window.',
        conflict: overlappingBookings[0],
      });
    }

    // 3. Timetable Integration: Check Academic Classes
    const dayOfWeek = start.getDay(); // 0-6
    const startHourMin = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    const endHourMin = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;

    const timetableConflicts = await prisma.timetableEntry.findMany({
      where: {
        resourceId: data.resourceId,
        dayOfWeek: dayOfWeek,
        AND: [
          { startTime: { lt: endHourMin } },
          { endTime: { gt: startHourMin } },
        ],
      },
    });

    if (timetableConflicts.length > 0) {
      const cls = timetableConflicts[0];
      return res.status(409).json({
        error: `Academic Timetable Conflict: ${cls.courseCode} - ${cls.courseName} is scheduled in this room on this day (${cls.startTime} - ${cls.endTime}).`,
        timetableConflict: cls,
      });
    }

    // 4. Department Approval Rules
    const policy = await prisma.departmentPolicy.findUnique({
      where: { department: resource.department },
    });

    const maxDays = policy ? policy.maxAdvanceDays : 14;
    const maxFutureDate = new Date();
    maxFutureDate.setDate(maxFutureDate.getDate() + maxDays);

    if (start > maxFutureDate) {
      return res.status(400).json({
        error: `Booking exceeds maximum advance reservation window of ${maxDays} days for this department.`,
      });
    }

    // Determine initial status:
    // If resource does not require approval OR user is faculty/admin, auto-confirm
    let initialStatus: BookingStatus = BookingStatus.PENDING;
    if (!resource.requiresApproval || user.role === Role.ADMINISTRATOR || user.role === Role.FACULTY) {
      initialStatus = BookingStatus.CONFIRMED;
    }

    // Generate unique booking number
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const bookingNumber = `LPU-${new Date().getFullYear()}-${randomSuffix}`;

    // 6-digit numeric check-in token
    const checkInToken = Math.floor(100000 + Math.random() * 900000).toString();

    // Release deadline: 15 minutes after start time
    const releaseDeadline = new Date(start.getTime() + (policy?.autoReleaseMinutes || 15) * 60000);

    const booking = await prisma.booking.create({
      data: {
        bookingNumber,
        userId: user.id,
        resourceId: data.resourceId,
        startTime: start,
        endTime: end,
        purpose: data.purpose,
        activityType: data.activityType,
        expectedAttendance: data.expectedAttendance,
        priority: data.priority,
        status: initialStatus,
        checkInToken,
        releaseDeadline,
        departmentId: resource.department,
      },
      include: {
        resource: true,
      },
    });

    // Create Notification
    await prisma.notification.create({
      data: {
        userId: user.id,
        title: initialStatus === BookingStatus.CONFIRMED
          ? `Booking Confirmed: ${resource.name}`
          : `Booking Request Submitted: ${resource.name}`,
        message: initialStatus === BookingStatus.CONFIRMED
          ? `Your booking #${bookingNumber} is confirmed for ${start.toLocaleDateString()} at ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Check-in code: ${checkInToken}`
          : `Your request #${bookingNumber} has been forwarded to the department approver for review.`,
        type: 'BOOKING',
        link: '/my-bookings',
      },
    });

    // If pending, notify approvers
    if (initialStatus === BookingStatus.PENDING) {
      const approvers = await prisma.user.findMany({
        where: {
          role: { in: [Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR] },
        },
      });

      for (const approver of approvers) {
        await prisma.notification.create({
          data: {
            userId: approver.id,
            title: `New Booking Request: ${resource.name}`,
            message: `${user.name} requested ${resource.name} for "${data.purpose}" on ${start.toLocaleDateString()}.`,
            type: 'APPROVAL',
            link: '/approvals',
          },
        });
      }
    }

    return res.status(201).json({
      booking,
      message: initialStatus === BookingStatus.CONFIRMED
        ? 'Booking successfully confirmed!'
        : 'Booking request submitted for department approval.',
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    console.error('Error creating booking:', err);
    return res.status(500).json({ error: 'Failed to create booking.' });
  }
});

// POST /api/bookings/:id/cancel
router.post('/:id/cancel', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const { reason } = req.body;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { resource: true },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    if (
      user.role === Role.STUDENT &&
      booking.userId !== user.id
    ) {
      return res.status(403).json({ error: 'Unauthorized to cancel this booking.' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        status: BookingStatus.CANCELLED,
        rejectionReason: reason || 'Cancelled by requester',
      },
    });

    // Notify user
    await prisma.notification.create({
      data: {
        userId: booking.userId,
        title: `Booking Cancelled: ${booking.resource.name}`,
        message: `Booking #${booking.bookingNumber} was successfully cancelled.`,
        type: 'BOOKING',
      },
    });

    return res.json({
      booking: updated,
      message: 'Booking cancelled successfully.',
    });
  } catch (err) {
    console.error('Error cancelling booking:', err);
    return res.status(500).json({ error: 'Failed to cancel booking.' });
  }
});

export default router;

