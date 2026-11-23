import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(
  async (_request: Request, { params }: { params: { id: string } }) => {
    const { id } = params;

    const resource = await prisma.resource.findUnique({
      where: { id },
      include: {
        timetableEntries: true,
        bookings: {
          where: {
            endTime: { gte: new Date() },
            status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING'] },
          },
          orderBy: { startTime: 'asc' },
          take: 10,
          select: {
            id: true,
            bookingNumber: true,
            startTime: true,
            endTime: true,
            purpose: true,
            status: true,
          },
        },
      },
    });

    if (!resource) {
      return fail(404, 'Resource not found.');
    }

    return ok({ resource });
  }
);
