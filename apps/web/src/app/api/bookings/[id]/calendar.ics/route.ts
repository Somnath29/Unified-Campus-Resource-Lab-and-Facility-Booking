import { prisma } from '@/lib/prisma';
import { fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { Role } from '@prisma/client';
import { generateSingleBookingIcs } from '@/lib/ics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        resource: {
          select: { name: true, building: true, floor: true, department: true },
        },
      },
    });

    if (!booking) {
      return fail(404, 'Booking not found.');
    }

    const isOwner = booking.userId === user.id;
    const isAdmin = user.role === Role.ADMINISTRATOR;
    const isApprover =
      user.role === Role.DEPARTMENT_APPROVER && user.department === booking.resource.department;

    if (!isOwner && !isAdmin && !isApprover) {
      return fail(403, 'Forbidden: You do not have permission to export this booking.');
    }

    const icsContent = generateSingleBookingIcs(booking);

    return new Response(icsContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${booking.bookingNumber || 'booking'}.ics"`,
        'Cache-Control': 'private, no-store, no-cache, must-revalidate',
      },
    });
  }
);
