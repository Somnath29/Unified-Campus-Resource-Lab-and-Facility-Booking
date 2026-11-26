import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { getRecommendations } from '@/services/recommendationService';
import { isValidDateString, isValidTimeString, getCurrentKolkataDateString } from '@/lib/timezone';
import { ResourceCategory } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  const date = searchParams.get('date') || getCurrentKolkataDateString();
  const startTime = searchParams.get('startTime') || searchParams.get('start') || '10:00';
  const endTime = searchParams.get('endTime') || searchParams.get('end');
  const durationMinutes = parseInt(searchParams.get('duration') || '60', 10);
  const expectedAttendance = parseInt(
    searchParams.get('attendance') || searchParams.get('expectedAttendance') || '20',
    10
  );
  const preferredBuilding = searchParams.get('building') || searchParams.get('preferredBuilding') || undefined;
  const amenitiesParam = searchParams.get('amenities') || searchParams.get('requiredAmenities');
  const requiredAmenities = amenitiesParam ? amenitiesParam.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const categoryParam = searchParams.get('category');
  const category = categoryParam && Object.values(ResourceCategory).includes(categoryParam as ResourceCategory)
    ? (categoryParam as ResourceCategory)
    : undefined;

  if (!isValidDateString(date)) {
    return fail(400, 'Invalid date format. Expected YYYY-MM-DD.');
  }

  if (!isValidTimeString(startTime)) {
    return fail(400, 'Invalid startTime format. Expected HH:mm.');
  }

  if (endTime && !isValidTimeString(endTime)) {
    return fail(400, 'Invalid endTime format. Expected HH:mm.');
  }

  if (isNaN(expectedAttendance) || expectedAttendance <= 0) {
    return fail(400, 'expectedAttendance must be a positive number.');
  }

  const result = await getRecommendations({
    date,
    startTime,
    endTime: endTime || undefined,
    durationMinutes: !endTime ? durationMinutes : undefined,
    expectedAttendance,
    preferredBuilding,
    requiredAmenities,
    category,
  });

  return ok(result);
});
