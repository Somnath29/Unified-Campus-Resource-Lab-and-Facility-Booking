import { prisma } from '@/lib/prisma';
import { BookingStatus, ResourceCategory } from '@prisma/client';
import {
  ResourceRecommendationRequest,
  ResourceRecommendationResponse,
  ResourceRecommendationItem,
  ResourceDTO,
} from '@lpu/shared';
import {
  isValidDateString,
  isValidTimeString,
  kolkataToUtc,
  getDayOfWeekInKolkata,
  validateOperatingHours,
} from '@/lib/timezone';

export async function getRecommendations(
  params: ResourceRecommendationRequest
): Promise<ResourceRecommendationResponse> {
  const {
    date,
    startTime,
    durationMinutes = 60,
    expectedAttendance,
    preferredBuilding,
    requiredAmenities = [],
    category,
  } = params;

  let endTime = params.endTime;
  if (!endTime) {
    const [sH, sM] = startTime.split(':').map(Number);
    const totalMinutes = sH * 60 + sM + durationMinutes;
    const eH = Math.floor(totalMinutes / 60);
    const eM = totalMinutes % 60;
    endTime = `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}`;
  }

  const startUtc = kolkataToUtc(date, startTime);
  const endUtc = kolkataToUtc(date, endTime);
  const dayOfWeek = getDayOfWeekInKolkata(startUtc);

  // 1. Fetch potential candidate resources (active, non-maintenance, capacity >= attendance)
  const whereClause: any = {
    deletedAt: null,
    isUnderMaintenance: false,
    capacity: { gte: expectedAttendance },
  };

  if (category) {
    whereClause.category = category;
  }

  const candidates = await prisma.resource.findMany({
    where: whereClause,
  });

  const recommendations: ResourceRecommendationItem[] = [];

  // 2. Fetch active blackout periods
  const departmentPolicies = await prisma.departmentPolicy.findMany({
    where: { blackoutPeriods: { not: null } },
  });

  const blackoutDepartments = new Set<string>();
  for (const pol of departmentPolicies) {
    if (!pol.blackoutPeriods) continue;
    try {
      const blackouts = JSON.parse(pol.blackoutPeriods);
      for (const b of blackouts) {
        const bStart = new Date(b.start);
        const bEnd = new Date(b.end);
        if (startUtc < bEnd && endUtc > bStart) {
          blackoutDepartments.add(pol.department);
          break;
        }
      }
    } catch {}
  }

  // 3. Evaluate each candidate resource for availability and rank score
  for (const res of candidates) {
    if (blackoutDepartments.has(res.department)) continue;

    // A. Check operating hours
    const opCheck = validateOperatingHours(startUtc, endUtc, res.operatingHours);
    if (!opCheck.valid) continue;

    // B. Check academic timetable conflict
    const timetableClash = await prisma.timetableEntry.findFirst({
      where: {
        resourceId: res.id,
        dayOfWeek,
        AND: [
          { startTime: { lt: endTime } },
          { endTime: { gt: startTime } },
        ],
      },
    });
    if (timetableClash) continue;

    // C. Check overlapping active bookings
    const bookingClash = await prisma.booking.findFirst({
      where: {
        resourceId: res.id,
        status: {
          in: [
            BookingStatus.PENDING,
            BookingStatus.APPROVED,
            BookingStatus.CONFIRMED,
            BookingStatus.CHECKED_IN,
          ],
        },
        AND: [
          { startTime: { lt: endUtc } },
          { endTime: { gt: startUtc } },
        ],
      },
    });
    if (bookingClash) continue;

    // 4. Calculate deterministic ranking score
    let score = 50;
    const reasons: string[] = [];

    // Capacity fit: optimal is capacity close to expectedAttendance
    const capacityRatio = res.capacity / expectedAttendance;
    if (capacityRatio >= 1.0 && capacityRatio <= 1.25) {
      score += 40; // Excellent fit
      reasons.push(`Optimal group size fit (${res.capacity} seats for ${expectedAttendance} attendees)`);
    } else if (capacityRatio <= 1.6) {
      score += 25;
      reasons.push(`Comfortable room size (${res.capacity} capacity)`);
    } else if (capacityRatio <= 2.5) {
      score += 10;
      reasons.push(`Accommodates up to ${res.capacity} people`);
    } else {
      score -= 10; // Large hall for small group
      reasons.push(`Spacious room (${res.capacity} seats)`);
    }

    // Building preference match
    const isBuildingMatch =
      !!preferredBuilding &&
      res.building.toLowerCase().includes(preferredBuilding.toLowerCase());

    if (isBuildingMatch) {
      score += 25;
      reasons.push(`Located in preferred building (${res.building})`);
    }

    // Amenity matches
    const resAmenitiesLower = res.amenities.map((a) => a.toLowerCase());
    const matchedAmenities: string[] = [];
    for (const req of requiredAmenities) {
      if (resAmenitiesLower.some((a) => a.includes(req.toLowerCase()))) {
        score += 15;
        matchedAmenities.push(req);
      }
    }
    if (matchedAmenities.length > 0) {
      reasons.push(`Equipped with ${matchedAmenities.join(', ')}`);
    }

    // Category match
    if (category && res.category === category) {
      score += 15;
    }

    recommendations.push({
      resource: {
        ...res,
        createdAt: res.createdAt.toISOString(),
      } as unknown as ResourceDTO,
      rankingScore: score,
      reason: reasons.join(' • '),
      capacityFitRatio: parseFloat(capacityRatio.toFixed(2)),
      matchedAmenities,
      buildingMatch: isBuildingMatch,
      isAvailable: true,
    });
  }

  // Sort descending by ranking score (highest first)
  recommendations.sort((a, b) => b.rankingScore - a.rankingScore);

  return {
    recommendations: recommendations.slice(0, 10),
    totalMatches: recommendations.length,
    criteria: {
      date,
      startTime,
      endTime,
      expectedAttendance,
      preferredBuilding,
      requiredAmenities,
      category,
    },
  };
}
