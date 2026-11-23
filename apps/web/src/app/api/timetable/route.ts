import { prisma } from '@/lib/prisma';
import { ok, withErrorHandling } from '@/lib/api-response';
import { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const resourceId = searchParams.get('resourceId');
  const department = searchParams.get('department');
  const dayOfWeek = searchParams.get('dayOfWeek');

  const where: Prisma.TimetableEntryWhereInput = {};
  if (resourceId) where.resourceId = resourceId;
  if (department) where.department = department;
  if (dayOfWeek !== null && dayOfWeek !== undefined && dayOfWeek !== '') {
    where.dayOfWeek = parseInt(dayOfWeek, 10);
  }

  const timetable = await prisma.timetableEntry.findMany({
    where,
    include: {
      resource: {
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          building: true,
        },
      },
    },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  });

  return ok({ timetable });
});
