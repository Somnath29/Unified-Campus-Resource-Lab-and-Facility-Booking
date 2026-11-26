import { prisma } from '../lib/prisma';
import { BookingStatus, ResourceCategory } from '@prisma/client';
import { AuthenticatedUser } from '../middleware/auth';
import { getAuthorizedDepartmentIds } from './approvalService';

/**
 * Checks whether a given start and end time falls within operating hours.
 */
function isWithinOperatingHours(operatingHours: string, start: Date, end: Date): boolean {
  if (!operatingHours || operatingHours.includes('notice') || operatingHours.includes('Event')) {
    return true;
  }

  try {
    const parts = operatingHours.split('-').map((s) => s.trim());
    if (parts.length !== 2) return true;

    const parseTime = (timeStr: string) => {
      const [time, modifier] = timeStr.split(' ');
      let [hours, minutes] = time.split(':').map(Number);
      if (modifier === 'PM' && hours < 12) hours += 12;
      if (modifier === 'AM' && hours === 12) hours = 0;
      return hours * 60 + (minutes || 0);
    };

    const openMin = parseTime(parts[0]);
    const closeMin = parseTime(parts[1]);

    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();

    return startMin >= openMin && endMin <= closeMin;
  } catch {
    return true;
  }
}

export interface CompetingBookingDTO {
  id: string;
  bookingNumber: string;
  expectedAttendance: number;
  priority: string;
  purpose: string;
  startTime: string;
  endTime: string;
  status: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    department?: string;
  };
}

export interface AlternativeRoomSuggestion {
  resourceId: string;
  resourceCode: string;
  name: string;
  category: ResourceCategory;
  capacity: number;
  building: string;
  floor: string | null;
  amenities: string[];
  imageUrl: string;
  department: string;
  matchScore: number;
  reasons: string[];
  isAvailable: boolean;
}

export interface AlternativeTimeSuggestion {
  startTime: string;
  endTime: string;
  durationMinutes: number;
  reason: string;
  isAvailable: boolean;
}

export interface SuggestionsResponse {
  bookingId: string;
  hasCompeting: boolean;
  competingBookings: CompetingBookingDTO[];
  competingCount: number;
  alternativeRooms: AlternativeRoomSuggestion[];
  alternativeTimes: AlternativeTimeSuggestion[];
}

/**
 * Finds all competing booking requests (PENDING, CONFIRMED, APPROVED, CHECKED_IN)
 * that overlap the requested time window on the same resource.
 */
export async function getCompetingBookings(
  bookingId: string,
  approver: AuthenticatedUser
): Promise<{ booking: any; competingBookings: CompetingBookingDTO[] }> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      resource: true,
      user: true,
      department: true,
    },
  });

  if (!booking) {
    throw new Error('Booking request not found.');
  }

  // Authorization check
  const authorizedDeptIds = await getAuthorizedDepartmentIds(approver);
  if (authorizedDeptIds !== null) {
    const bookingDeptId = booking.departmentId || booking.resource?.departmentId;
    const isAuthorized = bookingDeptId ? authorizedDeptIds.includes(bookingDeptId) : false;
    if (!isAuthorized) {
      throw new Error('Forbidden: You do not have approval permissions for this department resource.');
    }
  }

  const competingRecords = await prisma.booking.findMany({
    where: {
      resourceId: booking.resourceId,
      id: { not: booking.id },
      status: {
        in: [
          BookingStatus.PENDING,
          BookingStatus.CONFIRMED,
          BookingStatus.APPROVED,
          BookingStatus.CHECKED_IN,
        ],
      },
      startTime: { lt: booking.endTime },
      endTime: { gt: booking.startTime },
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, role: true, department: true },
      },
    },
    orderBy: [{ priority: 'desc' }, { submittedAt: 'asc' }],
  });

  const competingBookings: CompetingBookingDTO[] = competingRecords.map((c) => ({
    id: c.id,
    bookingNumber: c.bookingNumber,
    expectedAttendance: c.expectedAttendance,
    priority: c.priority,
    purpose: c.purpose,
    startTime: c.startTime.toISOString(),
    endTime: c.endTime.toISOString(),
    status: c.status,
    user: c.user,
  }));

  return { booking, competingBookings };
}

/**
 * Suggests alternative rooms ranked by suitability for the given booking request.
 * Filters out rooms under maintenance, rooms with insufficient capacity,
 * rooms with timetable clashes, or rooms with overlapping bookings during the time slot.
 * Ensures the approver has authorization for the suggested department resources.
 */
export async function suggestAlternativeRooms(
  booking: any,
  authorizedDeptIds: string[] | null,
  limit: number = 6
): Promise<AlternativeRoomSuggestion[]> {
  const attendance = booking.expectedAttendance || 1;
  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);
  const dayOfWeek = start.getDay();
  const startHM = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
  const endHM = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;

  // Candidate query with department authorization filter
  const whereFilter: any = {
    id: { not: booking.resourceId },
    isUnderMaintenance: false,
    capacity: { gte: attendance },
  };

  if (authorizedDeptIds !== null) {
    whereFilter.departmentId = { in: authorizedDeptIds };
  }

  const candidates = await prisma.resource.findMany({
    where: whereFilter,
    include: {
      timetableEntries: {
        where: {
          dayOfWeek,
          startTime: { lt: endHM },
          endTime: { gt: startHM },
        },
      },
      bookings: {
        where: {
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.CHECKED_IN] },
          startTime: { lt: end },
          endTime: { gt: start },
        },
      },
    },
  });

  const suggestions: AlternativeRoomSuggestion[] = [];

  for (const candidate of candidates) {
    // 1. Operating Hours validation
    if (!isWithinOperatingHours(candidate.operatingHours, start, end)) {
      continue;
    }

    // 2. Timetable clash validation
    if (candidate.timetableEntries.length > 0) {
      continue;
    }

    // 3. Overlapping confirmed booking clash validation
    if (candidate.bookings.length > 0) {
      continue;
    }

    // 4. Suitability Scoring & Reasons
    let score = 100;
    const reasons: string[] = [];

    // Building match (+40)
    if (candidate.building && booking.resource?.building && candidate.building.toLowerCase() === booking.resource.building.toLowerCase()) {
      score += 40;
      reasons.push(`Same building (${candidate.building})`);
    } else {
      reasons.push(`Building: ${candidate.building}`);
    }

    // Category match (+30)
    if (candidate.category === booking.resource?.category) {
      score += 30;
      reasons.push(`Matching category (${candidate.category.replace('_', ' ')})`);
    } else {
      reasons.push(`Category: ${candidate.category.replace('_', ' ')}`);
    }

    // Department match (+20)
    if (candidate.department && booking.resource?.department && candidate.department === booking.resource.department) {
      score += 20;
      reasons.push(`Same department (${candidate.department})`);
    }

    // Capacity proximity penalty (prefer rooms closest to requested attendance to prevent wasted capacity)
    const excessCapacity = candidate.capacity - attendance;
    const capacityPenalty = Math.min(30, Math.floor(excessCapacity / 5));
    score -= capacityPenalty;
    reasons.push(`Capacity fits ${attendance} guests (${candidate.capacity} seats, +${excessCapacity} extra)`);

    // Floor proximity if in same building
    if (
      candidate.building === booking.resource?.building &&
      candidate.floor &&
      booking.resource?.floor &&
      candidate.floor === booking.resource.floor
    ) {
      score += 10;
      reasons.push(`Same floor (${candidate.floor})`);
    }

    reasons.push('Verified free of timetable clashes & bookings');

    suggestions.push({
      resourceId: candidate.id,
      resourceCode: candidate.code,
      name: candidate.name,
      category: candidate.category,
      capacity: candidate.capacity,
      building: candidate.building,
      floor: candidate.floor,
      amenities: candidate.amenities,
      imageUrl: candidate.imageUrl,
      department: candidate.department,
      matchScore: score,
      reasons,
      isAvailable: true,
    });
  }

  // Sort descending by matchScore, then by capacity ascending (tightest fit first)
  suggestions.sort((a, b) => {
    if (b.matchScore !== a.matchScore) {
      return b.matchScore - a.matchScore;
    }
    return a.capacity - b.capacity;
  });

  return suggestions.slice(0, limit);
}

/**
 * Suggests alternative available time slots for the requested resource
 * on the same date or subsequent days if the requested slot has conflicts.
 */
export async function suggestAlternativeTimes(
  booking: any,
  limit: number = 4
): Promise<AlternativeTimeSuggestion[]> {
  const resource = booking.resource || (await prisma.resource.findUnique({ where: { id: booking.resourceId } }));
  if (!resource) return [];

  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);
  const durationMs = end.getTime() - start.getTime();
  const durationMinutes = Math.max(30, Math.round(durationMs / 60000));

  const candidateSlots: AlternativeTimeSuggestion[] = [];

  // Inspect up to 3 days (same day, +1 day, +2 days)
  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const targetDate = new Date(start);
    targetDate.setDate(targetDate.getDate() + dayOffset);
    const dayOfWeek = targetDate.getDay();

    // Standard campus slot start hours to test (08:00, 09:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 17:00)
    const testHours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

    for (const hour of testHours) {
      if (candidateSlots.length >= limit) break;

      const slotStart = new Date(targetDate);
      slotStart.setHours(hour, 0, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

      // Skip past times
      if (slotStart.getTime() <= Date.now()) continue;

      // Skip if this is the identical time as the existing booking
      if (
        slotStart.getTime() === start.getTime() &&
        slotEnd.getTime() === end.getTime()
      ) {
        continue;
      }

      // Check operating hours
      if (!isWithinOperatingHours(resource.operatingHours, slotStart, slotEnd)) {
        continue;
      }

      const startHM = `${String(slotStart.getHours()).padStart(2, '0')}:${String(slotStart.getMinutes()).padStart(2, '0')}`;
      const endHM = `${String(slotEnd.getHours()).padStart(2, '0')}:${String(slotEnd.getMinutes()).padStart(2, '0')}`;

      // Check timetable entry clash
      const timetableClash = await prisma.timetableEntry.findFirst({
        where: {
          resourceId: resource.id,
          dayOfWeek,
          startTime: { lt: endHM },
          endTime: { gt: startHM },
        },
      });
      if (timetableClash) continue;

      // Check confirmed/pending bookings clash
      const bookingClash = await prisma.booking.findFirst({
        where: {
          resourceId: resource.id,
          id: { not: booking.id },
          status: {
            in: [
              BookingStatus.CONFIRMED,
              BookingStatus.APPROVED,
              BookingStatus.CHECKED_IN,
              BookingStatus.PENDING,
            ],
          },
          startTime: { lt: slotEnd },
          endTime: { gt: slotStart },
        },
      });
      if (bookingClash) continue;

      let label = '';
      if (dayOffset === 0) {
        label = `Same day, ${slotStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${slotEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } else if (dayOffset === 1) {
        label = `Next day (${slotStart.toLocaleDateString([], { weekday: 'short' })}), ${slotStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${slotEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } else {
        label = `${slotStart.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${slotStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${slotEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }

      candidateSlots.push({
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
        durationMinutes,
        reason: `${label} (zero conflicts with classes or confirmed reservations)`,
        isAvailable: true,
      });
    }
  }

  return candidateSlots;
}

/**
 * Main coordinator function that provides full alternative suggestions and competing requests
 * for an approver reviewing a booking.
 */
export async function getAlternativeSuggestions(
  bookingId: string,
  approver: AuthenticatedUser
): Promise<SuggestionsResponse> {
  const { booking, competingBookings } = await getCompetingBookings(bookingId, approver);
  const authorizedDeptIds = await getAuthorizedDepartmentIds(approver);

  const [alternativeRooms, alternativeTimes] = await Promise.all([
    suggestAlternativeRooms(booking, authorizedDeptIds),
    suggestAlternativeTimes(booking),
  ]);

  return {
    bookingId: booking.id,
    hasCompeting: competingBookings.length > 0,
    competingBookings,
    competingCount: competingBookings.length,
    alternativeRooms,
    alternativeTimes,
  };
}
