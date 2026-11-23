import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;

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
      return fail(404, 'Booking not found.');
    }

    // Permission check
    if (user.role === Role.STUDENT && booking.userId !== user.id) {
      return fail(403, 'Unauthorized to view this booking.');
    }

    return ok({ booking });
  }
);
