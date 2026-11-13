import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { BookingStatus, Role } from '@prisma/client';

const router = Router();

// GET /api/approvals
router.get(
  '/',
  authenticateToken,
  requireRole(Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { status } = req.query;

      const where: any = {};
      if (status) {
        where.status = status as BookingStatus;
      } else {
        where.status = BookingStatus.PENDING;
      }

      const requests = await prisma.booking.findMany({
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
              phone: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({ requests });
    } catch (err) {
      console.error('Error fetching approval requests:', err);
      return res.status(500).json({ error: 'Failed to retrieve approval queue.' });
    }
  }
);

// POST /api/approvals/:id/action
router.post(
  '/:id/action',
  authenticateToken,
  requireRole(Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { action, notes, reason, alternateResourceId, newStartTime, newEndTime } = req.body;
      const approver = req.user!;

      const booking = await prisma.booking.findUnique({
        where: { id },
        include: { resource: true, user: true },
      });

      if (!booking) {
        return res.status(404).json({ error: 'Booking request not found.' });
      }

      if (action === 'APPROVE') {
        const checkInToken = Math.floor(100000 + Math.random() * 900000).toString();
        const releaseDeadline = new Date(booking.startTime.getTime() + 15 * 60000);

        const updated = await prisma.booking.update({
          where: { id },
          data: {
            status: BookingStatus.CONFIRMED,
            approvalNotes: notes || `Approved by ${approver.name} (${approver.designation || approver.role})`,
            checkInToken,
            releaseDeadline,
          },
        });

        // Notify user
        await prisma.notification.create({
          data: {
            userId: booking.userId,
            title: `Request Approved: ${booking.resource.name}`,
            message: `Your booking #${booking.bookingNumber} has been approved. Check-in code is ${checkInToken}.`,
            type: 'APPROVAL',
            link: '/my-bookings',
          },
        });

        // Audit Log
        await prisma.auditLog.create({
          data: {
            action: 'BOOKING_APPROVED',
            userId: approver.id,
            entityType: 'Booking',
            entityId: id,
            details: `Approved booking #${booking.bookingNumber} for ${booking.resource.name}`,
          },
        });

        return res.json({
          booking: updated,
          message: 'Booking request approved successfully.',
        });
      } else if (action === 'REJECT') {
        const updated = await prisma.booking.update({
          where: { id },
          data: {
            status: BookingStatus.REJECTED,
            rejectionReason: reason || 'Request does not meet department allocation criteria.',
          },
        });

        // Notify user
        await prisma.notification.create({
          data: {
            userId: booking.userId,
            title: `Request Declined: ${booking.resource.name}`,
            message: `Your booking request #${booking.bookingNumber} was declined. Reason: ${reason || 'Capacity/Policy limit reached'}.`,
            type: 'APPROVAL',
            link: '/my-bookings',
          },
        });

        // Audit Log
        await prisma.auditLog.create({
          data: {
            action: 'BOOKING_REJECTED',
            userId: approver.id,
            entityType: 'Booking',
            entityId: id,
            details: `Rejected booking #${booking.bookingNumber}. Reason: ${reason}`,
          },
        });

        return res.json({
          booking: updated,
          message: 'Booking request rejected.',
        });
      } else if (action === 'MODIFY') {
        // Approver modifies room or timing and confirms
        const newResource = alternateResourceId
          ? await prisma.resource.findUnique({ where: { id: alternateResourceId } })
          : booking.resource;

        const updatedStart = newStartTime ? new Date(newStartTime) : booking.startTime;
        const updatedEnd = newEndTime ? new Date(newEndTime) : booking.endTime;

        const checkInToken = Math.floor(100000 + Math.random() * 900000).toString();
        const releaseDeadline = new Date(updatedStart.getTime() + 15 * 60000);

        const updated = await prisma.booking.update({
          where: { id },
          data: {
            resourceId: newResource?.id || booking.resourceId,
            startTime: updatedStart,
            endTime: updatedEnd,
            status: BookingStatus.CONFIRMED,
            approvalNotes: notes || `Modified and approved by ${approver.name}. Assigned to ${newResource?.name}.`,
            checkInToken,
            releaseDeadline,
          },
        });

        // Notify user
        await prisma.notification.create({
          data: {
            userId: booking.userId,
            title: `Booking Modified & Approved: ${newResource?.name}`,
            message: `Your request #${booking.bookingNumber} was modified and approved for ${newResource?.name} at ${updatedStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Check-in code is ${checkInToken}.`,
            type: 'APPROVAL',
            link: '/my-bookings',
          },
        });

        return res.json({
          booking: updated,
          message: 'Booking modified and approved.',
        });
      } else {
        return res.status(400).json({ error: 'Invalid approval action specified.' });
      }
    } catch (err) {
      console.error('Error processing approval action:', err);
      return res.status(500).json({ error: 'Failed to process approval action.' });
    }
  }
);

export default router;

