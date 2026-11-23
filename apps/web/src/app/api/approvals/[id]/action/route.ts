import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireRole } from '@/lib/auth';
import { BookingStatus, Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const approver = await requireRole(request, Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR);
    const { id } = params;
    const body = await request.json().catch(() => ({}));
    const { action, notes, reason, alternateResourceId, newStartTime, newEndTime } = body;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { resource: true, user: true },
    });

    if (!booking) {
      return fail(404, 'Booking request not found.');
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

      return ok({
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

      return ok({
        booking: updated,
        message: 'Booking request rejected.',
      });
    } else if (action === 'MODIFY') {
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

      return ok({
        booking: updated,
        message: 'Booking modified and approved.',
      });
    } else {
      return fail(400, 'Invalid approval action specified.');
    }
  }
);
