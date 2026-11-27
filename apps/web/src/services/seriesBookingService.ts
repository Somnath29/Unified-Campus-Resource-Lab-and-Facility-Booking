import crypto from 'crypto';
import { hashPin } from '@/lib/checkin-crypto';
import { prisma } from '@/lib/prisma';
import {
  BookingStatus,
  ActivityType,
  PriorityLevel,
  Role,
  Prisma,
} from '@prisma/client';
import { ApiError } from '@/lib/auth';
import {
  validateOperatingHours,
  getDayOfWeekInKolkata,
  getTimeStringInKolkata,
  getDateStringInKolkata,
  kolkataToUtc,
  getKolkataWeekRange,
} from '@/lib/timezone';
import {
  RecurrenceService,
  addMinutesToTime,
} from './recurrenceService';
import {
  evaluateBookingPolicy,
  getWeeklyQuotaUsage,
} from './policyService';
import {
  BookingSeriesRequest,
  BookingSeriesResponse,
  BookingSeriesPreviewRequest,
  BookingSeriesPreviewResponse,
  BookingOccurrenceResult,
  BookingOccurrenceStatus,
  WeeklyQuotaBreakdown,
  SeriesCancellationRequest,
  SeriesCancellationResponse,
  OccurrenceCancellationScope,
  canCancelBooking,
  validateBookingTransition,
} from '@lpu/shared';
import {
  getNextBookingNumber,
  generateUniqueCheckInPin,
  BookingUserContext,
} from './bookingService';

/**
 * Computes deterministic hash for a recurring series request to enforce idempotency.
 */
export function computeSeriesRequestHash(input: BookingSeriesRequest): string {
  const normalized = {
    resourceId: input.resourceId,
    frequency: input.frequency,
    interval: input.interval || 1,
    weekdays: (input.weekdays || []).slice().sort(),
    startDate: input.startDate,
    until: input.until || null,
    count: input.count || null,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes || 60,
    expectedAttendance: input.expectedAttendance || 1,
    activityType: input.activityType || ActivityType.PROJECT_WORK,
    purpose: input.purpose.trim(),
    bookingMode: input.bookingMode,
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export class SeriesBookingService {
  /**
   * Read-only preview of a recurring booking series.
   * Evaluates availability, timetable clashes, and cumulative weekly quota without mutating the database.
   */
  static async previewSeries(
    user: BookingUserContext,
    input: BookingSeriesPreviewRequest
  ): Promise<BookingSeriesPreviewResponse> {
    const durationMinutes = input.durationMinutes || 60;

    // 1. Generate occurrences in Asia/Kolkata
    const occurrences = RecurrenceService.generateOccurrences({
      startDate: input.startDate,
      frequency: input.frequency,
      interval: input.interval,
      weekdays: input.weekdays,
      until: input.until,
      count: input.count,
      timeOfDay: input.startTime,
      durationMinutes,
    });

    // 2. Fetch target resource
    const resource = await prisma.resource.findUnique({
      where: { id: input.resourceId },
    });

    if (!resource || resource.deletedAt !== null) {
      throw new ApiError(404, 'Selected resource does not exist or has been archived.');
    }

    if (resource.isUnderMaintenance) {
      throw new ApiError(
        400,
        `Resource is temporarily blocked for maintenance: ${resource.maintenanceReason || 'Scheduled upkeep'}.`
      );
    }

    if (input.expectedAttendance > resource.capacity) {
      throw new ApiError(
        400,
        `Expected attendance (${input.expectedAttendance}) exceeds maximum capacity of ${resource.capacity}.`
      );
    }

    const durationHours = durationMinutes / 60;
    const weekAdditionalHours: Record<string, number> = {};
    const weekDetails: Record<
      string,
      {
        weekStart: string;
        weekEnd: string;
        maxWeeklyHours: number;
        alreadyBookedHours: number;
      }
    > = {};

    const results: BookingOccurrenceResult[] = [];
    let validCount = 0;
    let conflictCount = 0;

    for (const occ of occurrences) {
      const startUtc = new Date(occ.startUtc);
      const endUtc = new Date(occ.endUtc);
      const weekRange = getKolkataWeekRange(occ.date);
      const weekKey = weekRange.weekStartStr;

      // Track cumulative requested hours in this calendar week
      const currentWeekCumulative = weekAdditionalHours[weekKey] || 0;

      // A. Operating hours check
      const opCheck = validateOperatingHours(startUtc, endUtc, resource.operatingHours);
      if (!opCheck.valid) {
        conflictCount++;
        results.push({
          date: occ.date,
          startTime: occ.startTime,
          endTime: occ.endTime,
          durationMinutes: occ.durationMinutes,
          sequenceNumber: occ.sequenceNumber,
          status: 'CONFLICT',
          isCreated: false,
          reason: opCheck.reason || 'Outside facility operating hours.',
          conflictReason: opCheck.reason,
        });
        continue;
      }

      // B. Timetable clash check
      const dayOfWeek = getDayOfWeekInKolkata(startUtc);
      const timetableClash = await prisma.timetableEntry.findFirst({
        where: {
          resourceId: resource.id,
          dayOfWeek,
          AND: [
            { startTime: { lt: occ.endTime } },
            { endTime: { gt: occ.startTime } },
          ],
        },
      });

      if (timetableClash) {
        conflictCount++;
        results.push({
          date: occ.date,
          startTime: occ.startTime,
          endTime: occ.endTime,
          durationMinutes: occ.durationMinutes,
          sequenceNumber: occ.sequenceNumber,
          status: 'TIMETABLE_CLASH',
          isCreated: false,
          reason: `Timetable clash: ${timetableClash.courseCode} - ${timetableClash.courseName} (${timetableClash.startTime} - ${timetableClash.endTime}).`,
          conflictReason: `Timetable clash: ${timetableClash.courseCode}`,
        });
        continue;
      }

      // C. Existing active booking conflict
      const bookingClash = await prisma.booking.findFirst({
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
            { startTime: { lt: endUtc } },
            { endTime: { gt: startUtc } },
          ],
        },
      });

      if (bookingClash) {
        conflictCount++;
        results.push({
          date: occ.date,
          startTime: occ.startTime,
          endTime: occ.endTime,
          durationMinutes: occ.durationMinutes,
          sequenceNumber: occ.sequenceNumber,
          status: 'CONFLICT',
          isCreated: false,
          reason: 'Time slot overlaps with another reservation.',
          conflictReason: 'Overlapping reservation',
        });
        continue;
      }

      // Track week details for quota breakdown
      if (!weekDetails[weekKey]) {
        const weekQuota = await getWeeklyQuotaUsage({
          user,
          department: resource.department,
          date: startUtc,
          prisma,
          additionalHours: 0,
        });
        weekDetails[weekKey] = {
          weekStart: weekRange.weekStartStr,
          weekEnd: weekRange.weekEndStr,
          maxWeeklyHours: weekQuota.maxWeeklyHours,
          alreadyBookedHours: weekQuota.currentWeeklyHours,
        };
      }

      // D. A7 Policy & Weekly Quota evaluation (accounting for cumulative hours in this week)
      const policyDecision = await evaluateBookingPolicy({
        user,
        resource,
        startTime: startUtc,
        endTime: endUtc,
        prisma,
        additionalWeeklyHours: currentWeekCumulative,
        seriesStartDate: new Date(occurrences[0].startUtc),
      });

      if (!policyDecision.allowed) {
        conflictCount++;
        results.push({
          date: occ.date,
          startTime: occ.startTime,
          endTime: occ.endTime,
          durationMinutes: occ.durationMinutes,
          sequenceNumber: occ.sequenceNumber,
          status: 'POLICY_REFUSAL',
          isCreated: false,
          reason: policyDecision.reason || 'Policy refusal.',
          conflictReason: policyDecision.reason,
          remainingWeeklyQuota: policyDecision.remainingWeeklyQuota,
        });
        continue;
      }

      // Update cumulative hours for this calendar week
      weekAdditionalHours[weekKey] = currentWeekCumulative + durationHours;

      validCount++;
      const occurrenceStatus: BookingOccurrenceStatus = policyDecision.requiresApproval
        ? 'REQUIRES_APPROVAL'
        : 'AVAILABLE';

      results.push({
        date: occ.date,
        startTime: occ.startTime,
        endTime: occ.endTime,
        durationMinutes: occ.durationMinutes,
        sequenceNumber: occ.sequenceNumber,
        status: occurrenceStatus,
        isCreated: false,
        reason: policyDecision.reason || (policyDecision.requiresApproval ? 'Requires approver endorsement' : 'Available for booking'),
        remainingWeeklyQuota: policyDecision.remainingWeeklyQuota,
        autoReleaseMinutes: policyDecision.autoReleaseMinutes,
      });
    }

    // Build weekly quota breakdown summary
    const weeklyBreakdowns: WeeklyQuotaBreakdown[] = Object.keys(weekDetails).map((weekKey) => {
      const info = weekDetails[weekKey];
      const reqHours = weekAdditionalHours[weekKey] || 0;
      const totalProjected = info.alreadyBookedHours + reqHours;
      const isExceeded = totalProjected > info.maxWeeklyHours && user.role === Role.STUDENT;
      const remaining = Math.max(0, parseFloat((info.maxWeeklyHours - totalProjected).toFixed(1)));

      return {
        weekStart: info.weekStart,
        weekEnd: info.weekEnd,
        maxWeeklyHours: info.maxWeeklyHours,
        alreadyBookedHours: parseFloat(info.alreadyBookedHours.toFixed(1)),
        seriesRequestedHours: parseFloat(reqHours.toFixed(1)),
        remainingQuotaAfterSeries: remaining,
        isExceeded,
      };
    });

    return {
      totalOccurrences: occurrences.length,
      validOccurrencesCount: validCount,
      conflictingOccurrencesCount: conflictCount,
      occurrences: results,
      weeklyBreakdowns,
    };
  }

  /**
   * Creates a recurring series and its booking occurrences with Atomic or Partial modes.
   */
  static async createSeries({
    user,
    input,
    idempotencyKey,
  }: {
    user: BookingUserContext;
    input: BookingSeriesRequest;
    idempotencyKey?: string | null;
  }): Promise<BookingSeriesResponse> {
    const durationMinutes = input.durationMinutes || 60;
    const requestHash = computeSeriesRequestHash(input);

    // 1. Idempotency Check
    if (idempotencyKey) {
      const existingKeyRecord = await prisma.idempotencyKey.findUnique({
        where: {
          userId_key: {
            userId: user.id,
            key: idempotencyKey,
          },
        },
      });

      if (existingKeyRecord) {
        if (existingKeyRecord.requestHash !== requestHash) {
          throw new ApiError(
            409,
            'Idempotency conflict: The provided Idempotency-Key has already been used with different request parameters.'
          );
        }

        const cachedResponse: BookingSeriesResponse = JSON.parse(existingKeyRecord.responseBody);
        return {
          ...cachedResponse,
          message: `${cachedResponse.message} (Retrieved via idempotency key)`,
        };
      }
    }

    // 2. Generate occurrences
    const occurrences = RecurrenceService.generateOccurrences({
      startDate: input.startDate,
      frequency: input.frequency,
      interval: input.interval,
      weekdays: input.weekdays,
      until: input.until,
      count: input.count,
      timeOfDay: input.startTime,
      durationMinutes,
    });

    // 3. Load resource
    const resource = await prisma.resource.findUnique({
      where: { id: input.resourceId },
    });

    if (!resource || resource.deletedAt !== null) {
      throw new ApiError(404, 'Selected resource does not exist or has been archived.');
    }

    if (resource.isUnderMaintenance) {
      throw new ApiError(
        400,
        `Resource is temporarily blocked for maintenance: ${resource.maintenanceReason || 'Scheduled upkeep'}.`
      );
    }

    if (input.expectedAttendance > resource.capacity) {
      throw new ApiError(
        400,
        `Expected attendance (${input.expectedAttendance}) exceeds maximum capacity of ${resource.capacity}.`
      );
    }

    // 4. Pre-evaluate each occurrence
    const durationHours = durationMinutes / 60;
    const weekAdditionalHours: Record<string, number> = {};

    interface OccurrencePlan {
      occ: (typeof occurrences)[0];
      startUtc: Date;
      endUtc: Date;
      initialStatus: BookingStatus;
      autoReleaseMinutes: number;
      isValid: boolean;
      status: BookingOccurrenceStatus;
      reason: string;
      conflictReason?: string;
    }

    const plans: OccurrencePlan[] = [];

    for (const occ of occurrences) {
      const startUtc = new Date(occ.startUtc);
      const endUtc = new Date(occ.endUtc);
      const weekRange = getKolkataWeekRange(occ.date);
      const weekKey = weekRange.weekStartStr;
      const currentCumulative = weekAdditionalHours[weekKey] || 0;

      // Operating hours
      const opCheck = validateOperatingHours(startUtc, endUtc, resource.operatingHours);
      if (!opCheck.valid) {
        plans.push({
          occ,
          startUtc,
          endUtc,
          initialStatus: BookingStatus.REJECTED,
          autoReleaseMinutes: 15,
          isValid: false,
          status: 'CONFLICT',
          reason: opCheck.reason || 'Outside facility operating hours.',
          conflictReason: opCheck.reason,
        });
        continue;
      }

      // Timetable clash
      const dayOfWeek = getDayOfWeekInKolkata(startUtc);
      const timetableClash = await prisma.timetableEntry.findFirst({
        where: {
          resourceId: resource.id,
          dayOfWeek,
          AND: [
            { startTime: { lt: occ.endTime } },
            { endTime: { gt: occ.startTime } },
          ],
        },
      });

      if (timetableClash) {
        plans.push({
          occ,
          startUtc,
          endUtc,
          initialStatus: BookingStatus.REJECTED,
          autoReleaseMinutes: 15,
          isValid: false,
          status: 'TIMETABLE_CLASH',
          reason: `Academic timetable conflict: ${timetableClash.courseCode} - ${timetableClash.courseName} (${timetableClash.startTime} - ${timetableClash.endTime}).`,
          conflictReason: `Timetable conflict: ${timetableClash.courseCode}`,
        });
        continue;
      }

      // Existing booking clash
      const bookingClash = await prisma.booking.findFirst({
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
            { startTime: { lt: endUtc } },
            { endTime: { gt: startUtc } },
          ],
        },
      });

      if (bookingClash) {
        plans.push({
          occ,
          startUtc,
          endUtc,
          initialStatus: BookingStatus.REJECTED,
          autoReleaseMinutes: 15,
          isValid: false,
          status: 'CONFLICT',
          reason: 'Time slot overlaps with another reservation.',
          conflictReason: 'Overlapping reservation',
        });
        continue;
      }

      // Policy & quota check
      const policyDecision = await evaluateBookingPolicy({
        user,
        resource,
        startTime: startUtc,
        endTime: endUtc,
        prisma,
        additionalWeeklyHours: currentCumulative,
        seriesStartDate: new Date(occurrences[0].startUtc),
      });

      if (!policyDecision.allowed) {
        plans.push({
          occ,
          startUtc,
          endUtc,
          initialStatus: BookingStatus.REJECTED,
          autoReleaseMinutes: 15,
          isValid: false,
          status: 'POLICY_REFUSAL',
          reason: policyDecision.reason || 'Rejected by department policy.',
          conflictReason: policyDecision.reason,
        });
        continue;
      }

      weekAdditionalHours[weekKey] = currentCumulative + durationHours;

      plans.push({
        occ,
        startUtc,
        endUtc,
        initialStatus: policyDecision.initialStatus,
        autoReleaseMinutes: policyDecision.autoReleaseMinutes,
        isValid: true,
        status: policyDecision.requiresApproval ? 'REQUIRES_APPROVAL' : 'CREATED',
        reason: policyDecision.reason || 'Eligible for booking',
      });
    }

    const hasAnyFailure = plans.some((p) => !p.isValid);

    // ================= ATOMIC MODE =================
    if (input.bookingMode === 'ATOMIC') {
      if (hasAnyFailure) {
        const failureResults: BookingOccurrenceResult[] = plans.map((p) => {
          if (!p.isValid) {
            return {
              date: p.occ.date,
              startTime: p.occ.startTime,
              endTime: p.occ.endTime,
              durationMinutes: p.occ.durationMinutes,
              sequenceNumber: p.occ.sequenceNumber,
              status: p.status,
              isCreated: false,
              reason: p.reason,
              conflictReason: p.conflictReason,
            };
          }
          return {
            date: p.occ.date,
            startTime: p.occ.startTime,
            endTime: p.occ.endTime,
            durationMinutes: p.occ.durationMinutes,
            sequenceNumber: p.occ.sequenceNumber,
            status: 'SKIPPED_ATOMIC_FAILURE',
            isCreated: false,
            reason: 'Skipped due to atomic series failure on another date.',
          };
        });

        const firstFailure = plans.find((p) => !p.isValid);
        return {
          bookingMode: 'ATOMIC',
          totalOccurrences: occurrences.length,
          successfulCount: 0,
          failedCount: occurrences.length,
          results: failureResults,
          message: `Atomic booking failed: Occurrence on ${firstFailure?.occ.date} encountered conflict (${firstFailure?.reason}). All dates rolled back.`,
        };
      }

      // All occurrences valid: execute atomic transaction
      const responsePayload = await prisma.$transaction(
        async (tx) => {
          // Double check concurrency overlaps inside transaction
          for (const p of plans) {
            const overlap = await tx.booking.findFirst({
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
                  { startTime: { lt: p.endUtc } },
                  { endTime: { gt: p.startUtc } },
                ],
              },
            });

            if (overlap) {
              throw new ApiError(
                409,
                `Concurrent conflict detected for date ${p.occ.date}: slot was just reserved.`
              );
            }
          }

          // 1. Create BookingSeries
          const series = await tx.bookingSeries.create({
            data: {
              userId: user.id,
              resourceId: resource.id,
              frequency: input.frequency,
              interval: input.interval || 1,
              weekdays: input.weekdays || [],
              startDate: new Date(kolkataToUtc(input.startDate, input.startTime)),
              until: input.until ? new Date(kolkataToUtc(input.until, input.startTime)) : null,
              count: input.count || null,
              timeOfDay: input.startTime,
              duration: durationMinutes,
            },
          });

          // 2. Create all Booking occurrences linked to series
          const createdResults: BookingOccurrenceResult[] = [];

          for (const p of plans) {
            const bookingNumber = await getNextBookingNumber(tx);
            const checkInToken = await generateUniqueCheckInPin(tx);
            const releaseDeadline = new Date(p.startUtc.getTime() + p.autoReleaseMinutes * 60000);

            const b = await tx.booking.create({
              data: {
                bookingNumber,
                userId: user.id,
                resourceId: resource.id,
                seriesId: series.id,
                startTime: p.startUtc,
                endTime: p.endUtc,
                purpose: input.purpose.trim(),
                activityType: input.activityType || ActivityType.PROJECT_WORK,
                expectedAttendance: input.expectedAttendance,
                priority: input.priority || PriorityLevel.NORMAL,
                status: p.initialStatus,
                checkInToken: null,
                checkInPinHash: hashPin(checkInToken),
                releaseDeadline,
                departmentId: resource.department,
              },
            });

            createdResults.push({
              date: p.occ.date,
              startTime: p.occ.startTime,
              endTime: p.occ.endTime,
              durationMinutes: p.occ.durationMinutes,
              sequenceNumber: p.occ.sequenceNumber,
              status: p.initialStatus === BookingStatus.CONFIRMED ? 'CREATED' : 'REQUIRES_APPROVAL',
              isCreated: true,
              bookingId: b.id,
              bookingNumber: b.bookingNumber,
              approvalStatus: b.status,
              reason: p.reason,
            });
          }

          // 3. Audit Log
          await tx.auditLog.create({
            data: {
              action: 'BOOKING_SERIES_CREATED',
              userId: user.id,
              entityType: 'BookingSeries',
              entityId: series.id,
              details: JSON.stringify({
                frequency: input.frequency,
                totalBookings: createdResults.length,
                mode: 'ATOMIC',
              }),
            },
          });

          const res: BookingSeriesResponse = {
            seriesId: series.id,
            bookingMode: 'ATOMIC',
            totalOccurrences: occurrences.length,
            successfulCount: createdResults.length,
            failedCount: 0,
            results: createdResults,
            message: `Successfully created recurring series with ${createdResults.length} occurrences.`,
          };

          // 4. Idempotency Key
          if (idempotencyKey) {
            await tx.idempotencyKey.create({
              data: {
                key: idempotencyKey,
                userId: user.id,
                requestHash,
                statusCode: 201,
                responseBody: JSON.stringify(res),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              },
            });
          }

          return res;
        },
        {
          maxWait: 15000,
          timeout: 45000,
        }
      );

      // Send notifications outside transaction
      try {
        await prisma.notification.create({
          data: {
            userId: user.id,
            title: `Recurring Booking Confirmed: ${resource.name}`,
            message: `Your ${input.frequency.toLowerCase()} series of ${occurrences.length} bookings has been confirmed.`,
            type: 'BOOKING',
            link: '/my-bookings',
          },
        });
      } catch {}

      return responsePayload;
    }

    // ================= PARTIAL MODE =================
    const validPlans = plans.filter((p) => p.isValid);
    if (validPlans.length === 0) {
      const allFailedResults: BookingOccurrenceResult[] = plans.map((p) => ({
        date: p.occ.date,
        startTime: p.occ.startTime,
        endTime: p.occ.endTime,
        durationMinutes: p.occ.durationMinutes,
        sequenceNumber: p.occ.sequenceNumber,
        status: p.status,
        isCreated: false,
        reason: p.reason,
        conflictReason: p.conflictReason,
      }));

      return {
        bookingMode: 'PARTIAL',
        totalOccurrences: occurrences.length,
        successfulCount: 0,
        failedCount: occurrences.length,
        results: allFailedResults,
        message: 'No occurrences could be booked due to conflicts or policy refusals.',
      };
    }

    // Create series with valid occurrences
    const responsePayload = await prisma.$transaction(
      async (tx) => {
        // Create BookingSeries
        const series = await tx.bookingSeries.create({
          data: {
            userId: user.id,
            resourceId: resource.id,
            frequency: input.frequency,
            interval: input.interval || 1,
            weekdays: input.weekdays || [],
            startDate: new Date(kolkataToUtc(input.startDate, input.startTime)),
            until: input.until ? new Date(kolkataToUtc(input.until, input.startTime)) : null,
            count: input.count || null,
            timeOfDay: input.startTime,
            duration: durationMinutes,
          },
        });

        const results: BookingOccurrenceResult[] = [];
        let successCount = 0;
        let failCount = 0;

        for (const p of plans) {
          if (!p.isValid) {
            failCount++;
            results.push({
              date: p.occ.date,
              startTime: p.occ.startTime,
              endTime: p.occ.endTime,
              durationMinutes: p.occ.durationMinutes,
              sequenceNumber: p.occ.sequenceNumber,
              status: p.status,
              isCreated: false,
              reason: p.reason,
              conflictReason: p.conflictReason,
            });
            continue;
          }

          // Check overlap inside transaction
          const overlap = await tx.booking.findFirst({
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
                { startTime: { lt: p.endUtc } },
                { endTime: { gt: p.startUtc } },
              ],
            },
          });

          if (overlap) {
            failCount++;
            results.push({
              date: p.occ.date,
              startTime: p.occ.startTime,
              endTime: p.occ.endTime,
              durationMinutes: p.occ.durationMinutes,
              sequenceNumber: p.occ.sequenceNumber,
              status: 'CONFLICT',
              isCreated: false,
              reason: 'Concurrent reservation conflict detected on this date.',
              conflictReason: 'Overlapping reservation',
            });
            continue;
          }

          const bookingNumber = await getNextBookingNumber(tx);
          const checkInToken = await generateUniqueCheckInPin(tx);
          const releaseDeadline = new Date(p.startUtc.getTime() + p.autoReleaseMinutes * 60000);

          const b = await tx.booking.create({
            data: {
              bookingNumber,
              userId: user.id,
              resourceId: resource.id,
              seriesId: series.id,
              startTime: p.startUtc,
              endTime: p.endUtc,
              purpose: input.purpose.trim(),
              activityType: input.activityType || ActivityType.PROJECT_WORK,
              expectedAttendance: input.expectedAttendance,
              priority: input.priority || PriorityLevel.NORMAL,
              status: p.initialStatus,
              checkInToken: null,
              checkInPinHash: hashPin(checkInToken),
              releaseDeadline,
              departmentId: resource.department,
            },
          });

          successCount++;
          results.push({
            date: p.occ.date,
            startTime: p.occ.startTime,
            endTime: p.occ.endTime,
            durationMinutes: p.occ.durationMinutes,
            sequenceNumber: p.occ.sequenceNumber,
            status: p.initialStatus === BookingStatus.CONFIRMED ? 'CREATED' : 'REQUIRES_APPROVAL',
            isCreated: true,
            bookingId: b.id,
            bookingNumber: b.bookingNumber,
            approvalStatus: b.status,
            reason: p.reason,
          });
        }

        // Audit Log
        await tx.auditLog.create({
          data: {
            action: 'BOOKING_SERIES_CREATED',
            userId: user.id,
            entityType: 'BookingSeries',
            entityId: series.id,
            details: JSON.stringify({
              frequency: input.frequency,
              totalBookings: successCount,
              mode: 'PARTIAL',
              skipped: failCount,
            }),
          },
        });

        const res: BookingSeriesResponse = {
          seriesId: series.id,
          bookingMode: 'PARTIAL',
          totalOccurrences: occurrences.length,
          successfulCount: successCount,
          failedCount: failCount,
          results,
          message: `Partial booking: ${successCount} occurrences created, ${failCount} skipped due to conflicts/policies.`,
        };

        if (idempotencyKey) {
          await tx.idempotencyKey.create({
            data: {
              key: idempotencyKey,
              userId: user.id,
              requestHash,
              statusCode: 201,
              responseBody: JSON.stringify(res),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
        }

        return res;
      },
      {
        maxWait: 15000,
        timeout: 45000,
      }
    );

    return responsePayload;
  }

  /**
   * Cancels series occurrences with 3 supported scopes: ONE, THIS_AND_FOLLOWING, ENTIRE_SERIES.
   * Enforces permissions and booking state machine.
   */
  static async cancelSeriesBookings({
    user,
    seriesId,
    scope,
    targetBookingId,
    reason,
  }: {
    user: BookingUserContext;
    seriesId: string;
    scope: OccurrenceCancellationScope;
    targetBookingId?: string;
    reason?: string;
  }): Promise<SeriesCancellationResponse> {
    const series = await prisma.bookingSeries.findUnique({
      where: { id: seriesId },
      include: {
        bookings: {
          include: { resource: true },
          orderBy: { startTime: 'asc' },
        },
      },
    });

    if (!series) {
      throw new ApiError(404, 'Booking series not found.');
    }

    // Authorization
    const isOwner = series.userId === user.id;
    const isAdmin = user.role === Role.ADMINISTRATOR;
    if (!isOwner && !isAdmin) {
      throw new ApiError(403, 'Unauthorized to manage or cancel this booking series.');
    }

    // Target selection based on scope
    let targetBookings = series.bookings;

    if (scope === 'ONE') {
      if (!targetBookingId) {
        throw new ApiError(400, 'targetBookingId is required for scope ONE.');
      }
      const match = series.bookings.find((b) => b.id === targetBookingId);
      if (!match) {
        throw new ApiError(404, 'Specified booking does not belong to this series.');
      }
      targetBookings = [match];
    } else if (scope === 'THIS_AND_FOLLOWING') {
      if (!targetBookingId) {
        throw new ApiError(400, 'targetBookingId is required for scope THIS_AND_FOLLOWING.');
      }
      const match = series.bookings.find((b) => b.id === targetBookingId);
      if (!match) {
        throw new ApiError(404, 'Specified booking does not belong to this series.');
      }
      targetBookings = series.bookings.filter((b) => b.startTime >= match.startTime);
    }

    const cancellableBookings: typeof targetBookings = [];
    const skippedBookings: { id: string; reason: string }[] = [];

    for (const b of targetBookings) {
      if (b.status === BookingStatus.CANCELLED) {
        skippedBookings.push({ id: b.id, reason: 'Already cancelled.' });
      } else if (!canCancelBooking(b.status)) {
        skippedBookings.push({
          id: b.id,
          reason: `Cannot cancel booking with current status: ${b.status}.`,
        });
      } else {
        cancellableBookings.push(b);
      }
    }

    if (cancellableBookings.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const b of cancellableBookings) {
          validateBookingTransition(b.status, BookingStatus.CANCELLED);

          await tx.booking.update({
            where: { id: b.id },
            data: {
              status: BookingStatus.CANCELLED,
              rejectionReason: reason || (isOwner ? 'Cancelled by requester' : `Cancelled by ${user.name}`),
            },
          });

          await tx.auditLog.create({
            data: {
              action: 'SERIES_OCCURRENCE_CANCELLED',
              userId: user.id,
              entityType: 'Booking',
              entityId: b.id,
              details: JSON.stringify({
                bookingNumber: b.bookingNumber,
                seriesId,
                scope,
                cancelledBy: user.email,
                reason: reason || 'Cancelled series occurrence',
              }),
            },
          });
        }
      });

      // Trigger waitlist offers for each released occurrence independently
      try {
        const { WaitlistService } = await import('@/services/waitlistService');
        for (const b of cancellableBookings) {
          await WaitlistService.triggerSlotOffer({
            resourceId: b.resourceId,
            startTime: b.startTime,
            endTime: b.endTime,
          });
        }
      } catch (err) {
        console.error('[Waitlist trigger error on cancelSeriesBookings]', err);
      }
    }

    return {
      scope,
      cancelledCount: cancellableBookings.length,
      skippedCount: skippedBookings.length,
      cancelledBookingIds: cancellableBookings.map((b) => b.id),
      failedBookingIds: skippedBookings,
      message: `Successfully cancelled ${cancellableBookings.length} booking(s)${
        skippedBookings.length > 0 ? ` (${skippedBookings.length} skipped)` : ''
      }.`,
    };
  }
}
