import { ok, withErrorHandling } from '@/lib/api-response';
import { getRecommendations } from '@/services/recommendationService';
import { getCurrentKolkataDateString } from '@/lib/timezone';
import { ResourceCategory } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const { expectedAttendance, activityType, date, timeSlot, preferredBuilding, requiredAmenities } = body;

  const attendance = Number(expectedAttendance) || 30;
  const targetDate = date || getCurrentKolkataDateString();

  // Parse timeSlot e.g. "14:00 - 16:00" or default to 14:00 - 15:00
  let startTime = '14:00';
  let endTime = '15:00';
  if (timeSlot && typeof timeSlot === 'string' && timeSlot.includes('-')) {
    const parts = timeSlot.split('-').map((s) => s.trim());
    if (parts.length === 2) {
      startTime = parts[0];
      endTime = parts[1];
    }
  }

  let targetCategory: ResourceCategory | undefined = undefined;
  if (activityType === 'LAB_SESSION') {
    targetCategory = ResourceCategory.LAB;
  } else if (activityType === 'SPORTS_PRACTICE') {
    targetCategory = ResourceCategory.SPORTS;
  } else if (activityType === 'FACULTY_MEETING') {
    targetCategory = ResourceCategory.MEETING_ROOM;
  }

  const result = await getRecommendations({
    date: targetDate,
    startTime,
    endTime,
    expectedAttendance: attendance,
    preferredBuilding: preferredBuilding || undefined,
    requiredAmenities: Array.isArray(requiredAmenities) ? requiredAmenities : undefined,
    category: targetCategory,
  });

  return ok({
    matches: result.recommendations.map((r) => r.resource),
    recommendations: result.recommendations,
    totalMatches: result.totalMatches,
    criteria: {
      attendance,
      activityType,
      date: targetDate,
      timeSlot: `${startTime} - ${endTime}`,
      preferredBuilding,
    },
  });
});
