import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { BookingStatus, ActivityType, Role } from '@prisma/client';
import { evaluateBookingPolicy, getWeeklyQuotaUsage } from '@/services/policyService';
import {
  validateOperatingHours,
  getDayOfWeekInKolkata,
  getTimeStringInKolkata,
  getDateStringInKolkata,
  kolkataToUtc,
  addDaysKolkata,
  formatSlotTimeRange,
} from '@/lib/timezone';
import { AlternativeSlot, BookingPreviewResponse, PolicyDecisionType } from '@lpu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Searches for up to 3 genuine available alternative time slots on the same resource.
 */
async function findAlternativeSlots(
  resourceId: string,
  targetDate: string,
  durationMinutes: number,
  operatingHours: string
): Promise<AlternativeSlot[]> {
  const alternatives: AlternativeSlot[] = [];
  const datesToInspect = [targetDate, addDaysKolkata(targetDate, 1)];

  // Candidate start times to probe
  const candidateStarts = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

  for (const dateStr of datesToInspect) {
    if (alternatives.length >= 3) break;

    const dayOfWeek = getDayOfWeekInKolkata(kolkataToUtc(dateStr, '12:00'));

    for (const startHHMM of candidateStarts) {
      if (alternatives.length >= 3) break;

      const [sH, sM] = startHHMM.split(':').map(Number);
      const totalStartMin = sH * 60 + sM;
      const totalEndMin = totalStartMin + durationMinutes;

      const eH = Math.floor(totalEndMin / 60);
      const eM = totalEndMin % 60;
      if (eH >= 24) continue;

      const endHHMM = `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}`;

      const candStartUtc = kolkataToUtc(dateStr, startHHMM);
      const candEndUtc = kolkataToUtc(dateStr, endHHMM);

      // Check operating hours
      const opCheck = validateOperatingHours(candStartUtc, candEndUtc, operatingHours);
      if (!opCheck.valid) continue;

      // Check timetable conflict
      const timetableClash = await prisma.timetableEntry.findFirst({
        where: {
          resourceId,
          dayOfWeek,
          AND: [
            { startTime: { lt: endHHMM } },
            { endTime: { gt: startHHMM } },
          ],
        },
      });
      if (timetableClash) continue;

      // Check existing booking conflict
      const bookingClash = await prisma.booking.findFirst({
        where: {
          resourceId,
          status: {
            in: [
              BookingStatus.PENDING,
              BookingStatus.APPROVED,
              BookingStatus.CONFIRMED,
              BookingStatus.CHECKED_IN,
            ],
          },
          AND: [
            { startTime: { lt: candEndUtc } },
            { endTime: { gt: candStartUtc } },
          ],
        },
      });
      if (bookingClash) continue;

      alternatives.push({
        date: dateStr,
        startTime: startHHMM,
        endTime: endHHMM,
        durationMinutes,
      });
    }
  }

  return alternatives;
}

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const body = await request.json().catch(() => ({}));

  const { resourceId, startTime, endTime, expectedAttendance, activityType } = body;

  if (!resourceId || typeof resourceId !== 'string') {
    return fail(400, 'Resource ID is required.');
  }

  if (!startTime || !endTime) {
    return fail(400, 'Start time and end time are required.');
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return fail(400, 'Invalid start or end date/time format.');
  }

  if (end <= start) {
    return fail(400, 'End time must be strictly after start time.');
  }

  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (durationMinutes < 15) {
    return fail(400, 'Minimum booking duration is 15 minutes.');
  }
  if (durationMinutes > 480) {
    return fail(400, 'Maximum single booking duration is 8 hours.');
  }

  // 1. Fetch resource
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
  });

  if (!resource || resource.deletedAt !== null) {
    return fail(404, 'Selected resource does not exist or has been archived.');
  }

  const policyMessages: string[] = [];
  const targetDateStr = getDateStringInKolkata(start);

  // Quota usage for current user
  const quota = await getWeeklyQuotaUsage({
    user,
    department: resource.department,
    date: start,
    prisma,
  });

  // 2. Check Resource Maintenance
  if (resource.isUnderMaintenance) {
    return ok<BookingPreviewResponse>({
      allowed: false,
      decision: 'POLICY_REFUSAL',
      requiresApproval: true,
      initialStatus: BookingStatus.REJECTED,
      reason: `Resource is temporarily closed for maintenance: ${resource.maintenanceReason || 'Scheduled upkeep'}.`,
      remainingWeeklyQuota: quota.remainingWeeklyQuota,
      maxWeeklyHours: quota.maxWeeklyHours,
      currentWeeklyHours: quota.currentWeeklyHours,
      policyMessages: ['Facility maintenance blocks all reservation attempts.'],
      resource: {
        id: resource.id,
        name: resource.name,
        capacity: resource.capacity,
        operatingHours: resource.operatingHours,
        department: resource.department,
      },
    });
  }

  // 3. Attendance vs Capacity
  const attendance = Number(expectedAttendance) || 1;
  if (attendance > resource.capacity) {
    return ok<BookingPreviewResponse>({
      allowed: false,
      decision: 'POLICY_REFUSAL',
      requiresApproval: true,
      initialStatus: BookingStatus.REJECTED,
      reason: `Requested attendance (${attendance}) exceeds maximum room capacity of ${resource.capacity}.`,
      remainingWeeklyQuota: quota.remainingWeeklyQuota,
      maxWeeklyHours: quota.maxWeeklyHours,
      currentWeeklyHours: quota.currentWeeklyHours,
      policyMessages: [`Room maximum capacity is ${resource.capacity} people.`],
      resource: {
        id: resource.id,
        name: resource.name,
        capacity: resource.capacity,
        operatingHours: resource.operatingHours,
        department: resource.department,
      },
    });
  }

  // 4. Operating Hours Check
  const opCheck = validateOperatingHours(start, end, resource.operatingHours);
  if (!opCheck.valid) {
    const alternativeSlots = await findAlternativeSlots(
      resource.id,
      targetDateStr,
      durationMinutes,
      resource.operatingHours
    );

    return ok<BookingPreviewResponse>({
      allowed: false,
      decision: 'POLICY_REFUSAL',
      requiresApproval: true,
      initialStatus: BookingStatus.REJECTED,
      reason: opCheck.reason || 'Requested time slot is outside facility operating hours.',
      remainingWeeklyQuota: quota.remainingWeeklyQuota,
      maxWeeklyHours: quota.maxWeeklyHours,
      currentWeeklyHours: quota.currentWeeklyHours,
      policyMessages: [`Facility operating hours are ${resource.operatingHours}.`],
      alternativeSlots,
      resource: {
        id: resource.id,
        name: resource.name,
        capacity: resource.capacity,
        operatingHours: resource.operatingHours,
        department: resource.department,
      },
    });
  }

  // 5. Timetable Conflict Check
  const dayOfWeek = getDayOfWeekInKolkata(start);
  const startHHMM = getTimeStringInKolkata(start);
  const endHHMM = getTimeStringInKolkata(end);

  const timetableClash = await prisma.timetableEntry.findFirst({
    where: {
      resourceId: resource.id,
      dayOfWeek,
      AND: [
        { startTime: { lt: endHHMM } },
        { endTime: { gt: startHHMM } },
      ],
    },
  });

  if (timetableClash) {
    const alternativeSlots = await findAlternativeSlots(
      resource.id,
      targetDateStr,
      durationMinutes,
      resource.operatingHours
    );

    return ok<BookingPreviewResponse>({
      allowed: false,
      decision: 'POLICY_REFUSAL',
      requiresApproval: true,
      initialStatus: BookingStatus.REJECTED,
      reason: `Clashes with scheduled academic timetable class: ${timetableClash.courseCode} - ${timetableClash.courseName} (${timetableClash.startTime} - ${timetableClash.endTime}).`,
      remainingWeeklyQuota: quota.remainingWeeklyQuota,
      maxWeeklyHours: quota.maxWeeklyHours,
      currentWeeklyHours: quota.currentWeeklyHours,
      policyMessages: ['University classes take priority over casual reservations.'],
      alternativeSlots,
      resource: {
        id: resource.id,
        name: resource.name,
        capacity: resource.capacity,
        operatingHours: resource.operatingHours,
        department: resource.department,
      },
    });
  }

  // 6. Overlapping Active Bookings Check
  const overlappingBooking = await prisma.booking.findFirst({
    where: {
      resourceId: resource.id,
      status: {
        in: [
          BookingStatus.PENDING,
          BookingStatus.APPROVED,
          BookingStatus.CONFIRMED,
          BookingStatus.CHECKED_IN,
        ],
      },
      AND: [
        { startTime: { lt: end } },
        { endTime: { gt: start } },
      ],
    },
  });

  if (overlappingBooking) {
    const alternativeSlots = await findAlternativeSlots(
      resource.id,
      targetDateStr,
      durationMinutes,
      resource.operatingHours
    );

    return ok<BookingPreviewResponse>({
      allowed: false,
      decision: 'POLICY_REFUSAL',
      requiresApproval: true,
      initialStatus: BookingStatus.REJECTED,
      reason: 'This time slot is already booked or reserved by another campus group.',
      remainingWeeklyQuota: quota.remainingWeeklyQuota,
      maxWeeklyHours: quota.maxWeeklyHours,
      currentWeeklyHours: quota.currentWeeklyHours,
      policyMessages: ['The requested time window has an active overlapping reservation.'],
      alternativeSlots,
      resource: {
        id: resource.id,
        name: resource.name,
        capacity: resource.capacity,
        operatingHours: resource.operatingHours,
        department: resource.department,
      },
    });
  }

  // 7. Policy Engine Evaluation (A7)
  const policyDecision = await evaluateBookingPolicy({
    user,
    resource,
    startTime: start,
    endTime: end,
    prisma,
  });

  if (!policyDecision.allowed) {
    const alternativeSlots = await findAlternativeSlots(
      resource.id,
      targetDateStr,
      durationMinutes,
      resource.operatingHours
    );

    return ok<BookingPreviewResponse>({
      allowed: false,
      decision: 'POLICY_REFUSAL',
      requiresApproval: true,
      initialStatus: BookingStatus.REJECTED,
      reason: policyDecision.reason || 'Reservation rejected by department policy constraints.',
      remainingWeeklyQuota: policyDecision.remainingWeeklyQuota ?? quota.remainingWeeklyQuota,
      maxWeeklyHours: policyDecision.maxWeeklyHours ?? quota.maxWeeklyHours,
      currentWeeklyHours: policyDecision.currentWeeklyHours ?? quota.currentWeeklyHours,
      policyMessages: [policyDecision.reason || 'Department policy refusal.'],
      alternativeSlots,
      resource: {
        id: resource.id,
        name: resource.name,
        capacity: resource.capacity,
        operatingHours: resource.operatingHours,
        department: resource.department,
      },
    });
  }

  // Decision outcome
  let decision: PolicyDecisionType = 'AUTO_CONFIRMED';
  if (policyDecision.requiresApproval) {
    decision = 'REQUIRES_APPROVAL';
    policyMessages.push(
      policyDecision.reason ||
        (resource.requiresApproval
          ? 'Resource requires formal departmental approval.'
          : 'Reservation duration requires departmental approver review.')
    );
  } else {
    policyMessages.push('This reservation qualifies for immediate automatic confirmation upon submission.');
  }

  return ok<BookingPreviewResponse>({
    allowed: true,
    decision,
    requiresApproval: policyDecision.requiresApproval,
    initialStatus: policyDecision.initialStatus,
    reason: policyDecision.reason,
    remainingWeeklyQuota: policyDecision.remainingWeeklyQuota ?? quota.remainingWeeklyQuota,
    maxWeeklyHours: policyDecision.maxWeeklyHours ?? quota.maxWeeklyHours,
    currentWeeklyHours: policyDecision.currentWeeklyHours ?? quota.currentWeeklyHours,
    policyMessages,
    resource: {
      id: resource.id,
      name: resource.name,
      capacity: resource.capacity,
      operatingHours: resource.operatingHours,
      department: resource.department,
    },
  });
});
