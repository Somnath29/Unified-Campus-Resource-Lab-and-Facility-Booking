import { prisma } from '@/lib/prisma';
import { ok, withErrorHandling } from '@/lib/api-response';
import { requireRole } from '@/lib/auth';
import { BookingStatus, Role, Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  await requireRole(request, Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR);
  const { searchParams } = new URL(request.url);

  const status = searchParams.get('status');

  const where: Prisma.BookingWhereInput = {};
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

  return ok({ requests });
});
