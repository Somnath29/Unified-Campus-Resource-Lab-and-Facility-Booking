import { prisma } from '../lib/prisma';
import { BookingStatus } from '@prisma/client';

export function startAutoReleaseScheduler(intervalMs = 30000) {
  console.log(`⏱️ Auto-release scheduler active. Checking every ${intervalMs / 1000} seconds.`);

  setInterval(async () => {
    try {
      const now = new Date();
      const expiredBookings = await prisma.booking.findMany({
        where: {
          status: BookingStatus.CONFIRMED,
          releaseDeadline: { lt: now },
          checkedInAt: null,
        },
        include: { resource: true, user: true },
      });

      if (expiredBookings.length > 0) {
        console.log(`⚠️ Auto-releasing ${expiredBookings.length} expired reservations due to missed check-in deadline.`);
        for (const b of expiredBookings) {
          await prisma.booking.update({
            where: { id: b.id },
            data: {
              status: BookingStatus.NO_SHOW,
              approvalNotes: `Auto-released by background service at ${now.toLocaleTimeString()} (exceeded 15-min check-in window).`,
            },
          });

          await prisma.notification.create({
            data: {
              userId: b.userId,
              title: `Resource Released: ${b.resource.name}`,
              message: `Your booking #${b.bookingNumber} was automatically released because you did not check in within 15 minutes of the start time.`,
              type: 'CHECKIN',
              link: '/my-bookings',
            },
          });

          await prisma.auditLog.create({
            data: {
              action: 'AUTOMATIC_RESOURCE_RELEASE',
              entityType: 'Booking',
              entityId: b.id,
              details: `Auto-released resource ${b.resource.name} after missed check-in by ${b.user.name}`,
            },
          });
        }
      }
    } catch (err) {
      console.error('Error in background auto-release scheduler:', err);
    }
  }, intervalMs);
}

