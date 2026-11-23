import { prisma } from '@/lib/prisma';
import { ok, withErrorHandling } from '@/lib/api-response';
import { ResourceCategory } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const { expectedAttendance, activityType, date, timeSlot } = body;

  const attendance = Number(expectedAttendance) || 30;

  let targetCategories: ResourceCategory[] = [];
  if (activityType === 'LAB_SESSION') {
    targetCategories = [ResourceCategory.LAB];
  } else if (activityType === 'CLUB_EVENT' || activityType === 'GUEST_SEMINAR') {
    targetCategories = [ResourceCategory.SEMINAR_HALL, ResourceCategory.CLASSROOM];
  } else if (activityType === 'FACULTY_MEETING') {
    targetCategories = [ResourceCategory.MEETING_ROOM, ResourceCategory.SEMINAR_HALL];
  } else if (activityType === 'SPORTS_PRACTICE') {
    targetCategories = [ResourceCategory.SPORTS];
  } else {
    targetCategories = [
      ResourceCategory.CLASSROOM,
      ResourceCategory.LAB,
      ResourceCategory.SEMINAR_HALL,
      ResourceCategory.MEETING_ROOM,
    ];
  }

  const candidates = await prisma.resource.findMany({
    where: {
      category: { in: targetCategories },
      capacity: { gte: Math.floor(attendance * 0.8) },
      isUnderMaintenance: false,
    },
    orderBy: { capacity: 'asc' },
    take: 6,
  });

  return ok({
    matches: candidates,
    criteria: { attendance, activityType, date, timeSlot },
  });
});
