import { prisma } from '@/lib/prisma';
import { BookingStatus } from '@prisma/client';

export interface AutoReleaseResult {
  success: boolean;
  timestamp: string;
  releasedCount: number;
  releasedBookings: string[];
}

export async function processAutoRelease(): Promise<AutoReleaseResult> {
  const now = new Date();

  // Find confirmed bookings whose releaseDeadline has passed without check-in
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

    // Notify the user
    await prisma.notification.create({
      data: {
        userId: b.userId,
        title: `Booking Released (No-Show): ${b.resource.name}`,
        message: `Your booking #${b.bookingNumber} was automatically cancelled and released to other students because you missed the 15-minute check-in deadline.`,
        type: 'CHECKIN',
        link: '/my-bookings',
      },
    });

    // Create Audit log
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

  return {
    success: true,
    timestamp: now.toISOString(),
    releasedCount: releasedList.length,
    releasedBookings: releasedList,
  };
}
