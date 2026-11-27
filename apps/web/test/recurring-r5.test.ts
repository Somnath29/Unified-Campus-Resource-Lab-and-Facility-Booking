/**
 * TASK R5 AUTOMATED TEST SUITE: RECURRING BOOKINGS, SERIES MANAGEMENT & WEEKLY QUOTA METER
 * Run with: cd apps/web && npx tsx test/recurring-r5.test.ts
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { signToken } from '../src/lib/auth';
import { BookingStatus, Role, PriorityLevel, ActivityType } from '@prisma/client';
import {
  APP_TIMEZONE,
  getCurrentKolkataDateString,
  addDaysKolkata,
  kolkataToUtc,
  getKolkataWeekRange,
} from '../src/lib/timezone';
import { RecurrenceService } from '../src/services/recurrenceService';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

let testPassed = 0;
let testFailed = 0;

function pass(description: string) {
  testPassed++;
  console.log(`  ✓ PASSED: ${description}`);
}

function fail(description: string, error: any) {
  testFailed++;
  console.error(`  ❌ FAILED: ${description}`);
  console.error(error);
}

let studentUser: any;
let studentToken: string;
let facultyUser: any;
let facultyToken: string;
let autoResource: any;
let approvalResource: any;

const todayStr = getCurrentKolkataDateString();

function getNextWeekdayDate(dayName: string, minDaysAhead = 1): string {
  const map: Record<string, number> = {
    SUNDAY: 0,
    MONDAY: 1,
    TUESDAY: 2,
    WEDNESDAY: 3,
    THURSDAY: 4,
    FRIDAY: 5,
    SATURDAY: 6,
  };
  const targetDay = map[dayName.toUpperCase()];
  const baseDate = addDaysKolkata(todayStr, minDaysAhead);
  for (let i = 0; i < 7; i++) {
    const cur = addDaysKolkata(baseDate, i);
    const d = kolkataToUtc(cur, '12:00');
    if (d.getUTCDay() === targetDay) return cur;
  }
  return baseDate;
}

async function cleanup() {
  await prisma.idempotencyKey.deleteMany({
    where: { key: { startsWith: 'r5-test-' } },
  });

  await prisma.booking.deleteMany({
    where: {
      OR: [
        { bookingNumber: { startsWith: 'LPU-TEST-' } },
        { purpose: { contains: 'R5' } },
        { purpose: { contains: 'R4' } },
        { purpose: { contains: 'Plant clash' } },
        { purpose: { contains: 'Blocking Booking' } },
        { purpose: { contains: 'Study Group' } },
        { purpose: { contains: 'Series Cancellation Target' } },
        { purpose: { contains: 'Idempotency' } },
        { seriesId: { not: null } },
      ],
    },
  });

  await prisma.bookingSeries.deleteMany({});
}

async function setup() {
  console.log('\n======================================================');
  console.log('🚀 INITIALIZING R5 TEST SUITE: RECURRING SERIES & QUOTA');
  console.log('======================================================\n');

  // Load seed users
  studentUser = await prisma.user.findUnique({ where: { email: 'ketan.12204598@lpu.in' } });
  facultyUser = await prisma.user.findUnique({ where: { email: 'arvind.cse@lpu.in' } });

  if (!studentUser || !facultyUser) {
    throw new Error('Seed users missing. Run npm run db:seed first.');
  }

  studentToken = signToken({ id: studentUser.id, email: studentUser.email, role: studentUser.role });
  facultyToken = signToken({ id: facultyUser.id, email: facultyUser.email, role: facultyUser.role });

  // Pick CSE Classroom 204
  autoResource = await prisma.resource.findFirst({
    where: {
      name: 'CSE Classroom 204',
      requiresApproval: false,
      isUnderMaintenance: false,
      deletedAt: null,
    },
  });

  if (!autoResource) {
    autoResource = await prisma.resource.findFirst({
      where: {
        requiresApproval: false,
        isUnderMaintenance: false,
        deletedAt: null,
      },
    });
  }

  approvalResource = await prisma.resource.findFirst({
    where: {
      requiresApproval: true,
      isUnderMaintenance: false,
      deletedAt: null,
    },
  });

  assert.ok(autoResource, 'Auto-confirmable resource exists');
  assert.ok(approvalResource, 'Approval-required resource exists');

  // Clean up any test series and idempotency keys from prior test runs
  await cleanup();

  console.log(`  ✓ Seed data loaded: Student (${studentUser.email}), Resource (${autoResource.name})`);
}

async function runRecurrenceEngineTests() {
  console.log('\n--- SUITE 1: Recurrence Engine Unit Tests (RecurrenceService) ---');

  // 1.1 Daily series with interval 1
  try {
    const occs = RecurrenceService.generateOccurrences({
      startDate: '2026-12-01',
      frequency: 'DAILY',
      interval: 1,
      count: 5,
      timeOfDay: '10:00',
      durationMinutes: 60,
    });
    assert.strictEqual(occs.length, 5, 'Should generate exactly 5 daily occurrences');
    assert.strictEqual(occs[0].date, '2026-12-01');
    assert.strictEqual(occs[4].date, '2026-12-05');
    assert.strictEqual(occs[0].startTime, '10:00');
    assert.strictEqual(occs[0].endTime, '11:00');
    pass('Daily series interval 1 generates 5 consecutive calendar days');
  } catch (err) {
    fail('Daily series interval 1', err);
  }

  // 1.2 Daily series with interval 2
  try {
    const occs = RecurrenceService.generateOccurrences({
      startDate: '2026-12-01',
      frequency: 'DAILY',
      interval: 2,
      count: 4,
      timeOfDay: '14:00',
      durationMinutes: 90,
    });
    assert.strictEqual(occs.length, 4);
    assert.strictEqual(occs[0].date, '2026-12-01');
    assert.strictEqual(occs[1].date, '2026-12-03');
    assert.strictEqual(occs[2].date, '2026-12-05');
    assert.strictEqual(occs[3].date, '2026-12-07');
    assert.strictEqual(occs[0].endTime, '15:30');
    pass('Daily series interval 2 skips alternate days correctly');
  } catch (err) {
    fail('Daily series interval 2', err);
  }

  // 1.3 Weekly multi-day series (Monday + Wednesday)
  try {
    const occs = RecurrenceService.generateOccurrences({
      startDate: '2026-12-07',
      frequency: 'WEEKLY',
      interval: 1,
      weekdays: ['MONDAY', 'WEDNESDAY'],
      count: 4,
      timeOfDay: '09:00',
      durationMinutes: 60,
    });
    assert.strictEqual(occs.length, 4);
    assert.strictEqual(occs[0].date, '2026-12-07'); // Mon
    assert.strictEqual(occs[1].date, '2026-12-09'); // Wed
    assert.strictEqual(occs[2].date, '2026-12-14'); // Mon
    assert.strictEqual(occs[3].date, '2026-12-16'); // Wed
    pass('Weekly multi-day (Mon/Wed) series generates interleaved dates');
  } catch (err) {
    fail('Weekly multi-day series', err);
  }

  // 1.4 Max occurrences validation (must not exceed 16)
  try {
    assert.throws(
      () => {
        RecurrenceService.validateRule({
          startDate: '2026-12-01',
          frequency: 'DAILY',
          interval: 1,
          count: 17,
          timeOfDay: '10:00',
          durationMinutes: 60,
        });
      },
      /exceed/i,
      'Count > 16 must throw an error'
    );
    pass('Rule validation rejects count > 16 strictly');
  } catch (err) {
    fail('Count > 16 validation', err);
  }

  // 1.5 Until date boundary
  try {
    const occs = RecurrenceService.generateOccurrences({
      startDate: '2026-12-01',
      frequency: 'WEEKLY',
      interval: 1,
      weekdays: ['TUESDAY'],
      until: '2026-12-22',
      timeOfDay: '11:00',
      durationMinutes: 60,
    });
    assert.strictEqual(occs.length, 4);
    assert.strictEqual(occs[3].date, '2026-12-22');
    pass('Weekly series terminating by until date respects exact calendar boundaries');
  } catch (err) {
    fail('Until date boundary', err);
  }
}

async function runPreviewApiTests() {
  console.log('\n--- SUITE 2: Recurring Preview API Tests ---');

  // 2.1 Unauthenticated rejection
  try {
    const res = await fetch(`${BASE_URL}/api/bookings/series/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceId: autoResource.id,
        startDate: getNextWeekdayDate('TUESDAY', 1),
        frequency: 'WEEKLY',
        interval: 1,
        weekdays: ['TUESDAY'],
        count: 4,
        startTime: '15:00',
        durationMinutes: 60,
        expectedAttendance: 20,
      }),
    });
    assert.strictEqual(res.status, 401, 'Should return 401 for unauthenticated request');
    pass('Recurring preview rejects unauthenticated requests with 401');
  } catch (err) {
    fail('Unauthenticated preview rejection', err);
  }

  // 2.2 Valid 4-week preview with cumulative weekly quota calculation
  try {
    const bookingsBefore = await prisma.booking.count();
    const seriesBefore = await prisma.bookingSeries.count();
    const previewStartDate = getNextWeekdayDate('TUESDAY', 1);

    const res = await fetch(`${BASE_URL}/api/bookings/series/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        resourceId: autoResource.id,
        startDate: previewStartDate,
        frequency: 'WEEKLY',
        interval: 1,
        weekdays: ['TUESDAY'],
        count: 4,
        startTime: '15:00',
        durationMinutes: 60,
        expectedAttendance: 20,
      }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.totalOccurrences, 4);
    assert.strictEqual(data.occurrences.length, 4);
    assert.strictEqual(data.validOccurrencesCount, 4, 'All 4 afternoon slots should be available');
    assert.ok(data.weeklyBreakdowns.length >= 1, 'Should include weeklyBreakdowns');

    // Verify ZERO side-effects
    const bookingsAfter = await prisma.booking.count();
    const seriesAfter = await prisma.bookingSeries.count();
    assert.strictEqual(bookingsAfter, bookingsBefore, 'Preview must not create bookings');
    assert.strictEqual(seriesAfter, seriesBefore, 'Preview must not create series');

    pass('Preview returns 4 occurrences and weekly quota breakdown with 0 database mutations');
  } catch (err) {
    fail('Valid recurring preview with zero side-effects', err);
  }
}

async function runAtomicBookingTests() {
  console.log('\n--- SUITE 3: 10-Week Atomic Booking Acceptance Test ---');

  // Scenario A: 10-week series with all valid slots creates 10 bookings linked to 1 BookingSeries
  let createdSeriesId = '';
  try {
    const key = `r5-test-atomic-${Date.now()}`;
    const seriesStartDate = getNextWeekdayDate('THURSDAY', 1);

    const res = await fetch(`${BASE_URL}/api/bookings/series`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        resourceId: autoResource.id,
        frequency: 'WEEKLY',
        interval: 1,
        weekdays: ['THURSDAY'],
        startDate: seriesStartDate,
        count: 10,
        startTime: '15:00',
        durationMinutes: 60,
        expectedAttendance: 15,
        activityType: 'PROJECT_WORK',
        purpose: 'R5 10-Week Study Group Series',
        bookingMode: 'ATOMIC',
      }),
    });

    const data = await res.json();
    assert.ok(res.status === 200 || res.status === 201, `Expected 200/201, got ${res.status}: ${JSON.stringify(data)}`);
    assert.strictEqual(data.bookingMode, 'ATOMIC');
    assert.strictEqual(data.totalOccurrences, 10);
    assert.strictEqual(data.successfulCount, 10);
    assert.strictEqual(data.failedCount, 0);
    assert.ok(data.seriesId, 'Should return created seriesId');
    createdSeriesId = data.seriesId;

    // Verify database state: exactly 10 bookings linked to this series
    const dbBookings = await prisma.booking.findMany({
      where: { seriesId: createdSeriesId },
    });
    assert.strictEqual(dbBookings.length, 10, 'Database should contain exactly 10 linked bookings');
    pass('Scenario A: 10-week Atomic series creates exactly 10 bookings linked to 1 series');
  } catch (err) {
    fail('Scenario A: 10-week Atomic series creation', err);
  }

  // Scenario B: Series with 1 conflicting date rolls back completely (0 bookings, no series)
  try {
    const seriesStartDate = getNextWeekdayDate('FRIDAY', 1);
    const occurrence3Date = addDaysKolkata(seriesStartDate, 14); // 3rd Friday

    await prisma.booking.deleteMany({
      where: {
        resourceId: autoResource.id,
        startTime: new Date(`${occurrence3Date}T15:00:00+05:30`),
      },
    });

    // Intentionally create a single conflicting booking on week 3
    const conflictBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-CONFLICT-${Date.now().toString().slice(-6)}`,
        userId: facultyUser.id,
        resourceId: autoResource.id,
        startTime: new Date(`${occurrence3Date}T15:00:00+05:30`),
        endTime: new Date(`${occurrence3Date}T16:00:00+05:30`),
        status: BookingStatus.CONFIRMED,
        purpose: 'Blocking Booking for Atomic Rollback Test',
        activityType: ActivityType.CLASS_LECTURE,
        expectedAttendance: 20,
      },
    });

    const key = `r5-test-atomic-fail-${Date.now()}`;
    const res = await fetch(`${BASE_URL}/api/bookings/series`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        resourceId: autoResource.id,
        frequency: 'WEEKLY',
        interval: 1,
        weekdays: ['FRIDAY'],
        startDate: seriesStartDate,
        count: 5,
        startTime: '15:00',
        durationMinutes: 60,
        expectedAttendance: 15,
        activityType: 'PROJECT_WORK',
        purpose: 'Atomic Conflict Series Test',
        bookingMode: 'ATOMIC',
      }),
    });

    const data = await res.json();
    assert.strictEqual(res.status, 409, `Atomic series with conflict must return 409, got ${res.status}`);
    assert.strictEqual(data.successfulCount, 0, 'Successful count must be 0 in atomic rollback');
    assert.strictEqual(data.failedCount, 5, 'All 5 occurrences reported as failed/skipped');

    // Verify database state: zero bookings created for student for this request
    const studentBookings = await prisma.booking.findMany({
      where: {
        userId: studentUser.id,
        purpose: 'Atomic Conflict Series Test',
      },
    });
    assert.strictEqual(studentBookings.length, 0, 'Zero bookings must exist in DB after atomic rollback');

    // Clean up the conflict booking
    await prisma.booking.delete({ where: { id: conflictBooking.id } });
    pass('Scenario B: Atomic series with 1 conflict rolls back 100% cleanly (0 bookings, 409 returned)');
  } catch (err) {
    fail('Scenario B: Atomic series rollback', err);
  }
}

async function runPartialBookingTests() {
  console.log('\n--- SUITE 4: Partial Booking Tests ---');

  try {
    const seriesStartDate = getNextWeekdayDate('MONDAY', 1);
    const clashDate = addDaysKolkata(seriesStartDate, 7); // Occurrence 2 (2nd Monday)

    await prisma.booking.deleteMany({
      where: {
        resourceId: autoResource.id,
        startTime: new Date(`${clashDate}T15:00:00+05:30`),
      },
    });

    // Plant a clash on date 2 of a 4-date series
    const clashBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-CLASH-${Date.now().toString().slice(-6)}`,
        userId: facultyUser.id,
        resourceId: autoResource.id,
        startTime: new Date(`${clashDate}T15:00:00+05:30`),
        endTime: new Date(`${clashDate}T16:00:00+05:30`),
        status: BookingStatus.CONFIRMED,
        purpose: 'Plant clash for partial booking test',
        activityType: ActivityType.CLASS_LECTURE,
        expectedAttendance: 20,
      },
    });

    const key = `r5-test-partial-${Date.now()}`;
    const res = await fetch(`${BASE_URL}/api/bookings/series`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        resourceId: autoResource.id,
        frequency: 'WEEKLY',
        interval: 1,
        weekdays: ['MONDAY'],
        startDate: seriesStartDate,
        count: 4,
        startTime: '15:00',
        durationMinutes: 60,
        expectedAttendance: 15,
        activityType: 'PROJECT_WORK',
        purpose: 'Partial Booking Series Test',
        bookingMode: 'PARTIAL',
      }),
    });

    const data = await res.json();
    assert.ok(res.status === 200 || res.status === 201);
    assert.strictEqual(data.bookingMode, 'PARTIAL');
    assert.strictEqual(data.totalOccurrences, 4);
    assert.strictEqual(data.successfulCount, 3, 'Exactly 3 valid dates should be booked');
    assert.strictEqual(data.failedCount, 1, 'Exactly 1 clashing date should be skipped');

    // Verify DB state
    const createdBookings = await prisma.booking.findMany({
      where: { seriesId: data.seriesId },
    });
    assert.strictEqual(createdBookings.length, 3, 'Database should contain exactly 3 bookings');

    // Clean up
    await prisma.booking.delete({ where: { id: clashBooking.id } });
    pass('Partial mode books 3 available dates and skips 1 conflict with per-date report');
  } catch (err) {
    fail('Partial booking test', err);
  }
}

async function runCancellationTests() {
  console.log('\n--- SUITE 5: Series Cancellation Tests (ONE, THIS_AND_FOLLOWING, ENTIRE_SERIES) ---');

  // 5.1 Create a 6-occurrence series to test cancellations
  let testSeriesId = '';
  let seriesBookings: any[] = [];
  try {
    const key = `r5-test-cancel-setup-${Date.now()}`;
    const seriesStartDate = getNextWeekdayDate('WEDNESDAY', 1);

    const res = await fetch(`${BASE_URL}/api/bookings/series`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        resourceId: autoResource.id,
        frequency: 'WEEKLY',
        interval: 1,
        weekdays: ['WEDNESDAY'],
        startDate: seriesStartDate,
        count: 6,
        startTime: '15:00',
        durationMinutes: 60,
        expectedAttendance: 10,
        activityType: 'PROJECT_WORK',
        purpose: 'Series Cancellation Target',
        bookingMode: 'ATOMIC',
      }),
    });
    const data = await res.json();
    assert.ok(res.status === 200 || res.status === 201, `Failed to create cancel test series: ${res.status} ${JSON.stringify(data)}`);
    testSeriesId = data.seriesId;
    assert.ok(testSeriesId, 'Series ID must be present');

    seriesBookings = await prisma.booking.findMany({
      where: { seriesId: testSeriesId },
      orderBy: { startTime: 'asc' },
    });
    assert.strictEqual(seriesBookings.length, 6, 'Must create exactly 6 bookings');
  } catch (err) {
    fail('Cancellation test setup', err);
    return;
  }

  // 5.2 Cancel scope: ONE (Occurrence 2)
  try {
    const targetBooking = seriesBookings[1];
    const res = await fetch(`${BASE_URL}/api/bookings/series/${testSeriesId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        scope: 'ONE',
        targetBookingId: targetBooking.id,
        reason: 'Unable to attend session 2',
      }),
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.cancelledCount, 1);

    const b2 = await prisma.booking.findUnique({ where: { id: targetBooking.id } });
    assert.strictEqual(b2?.status, BookingStatus.CANCELLED);

    const remainingActive = await prisma.booking.count({
      where: { seriesId: testSeriesId, status: { not: BookingStatus.CANCELLED } },
    });
    assert.strictEqual(remainingActive, 5, '5 occurrences must remain active');
    pass('Scope ONE cancels only the specified booking while others remain active');
  } catch (err) {
    fail('Scope ONE cancellation', err);
  }

  // 5.3 Cancel scope: THIS_AND_FOLLOWING (Starting from Occurrence 4)
  try {
    const targetBooking = seriesBookings[3]; // Index 3 is Occurrence 4
    const res = await fetch(`${BASE_URL}/api/bookings/series/${testSeriesId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        scope: 'THIS_AND_FOLLOWING',
        targetBookingId: targetBooking.id,
        reason: 'Project completed early, cancelling remainder',
      }),
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.cancelledCount, 3, 'Should cancel occurrences 4, 5, 6');

    // Occurrences 1 and 3 should remain active (since 2 was cancelled earlier)
    const b1 = await prisma.booking.findUnique({ where: { id: seriesBookings[0].id } });
    const b3 = await prisma.booking.findUnique({ where: { id: seriesBookings[2].id } });
    const b4 = await prisma.booking.findUnique({ where: { id: seriesBookings[3].id } });
    const b5 = await prisma.booking.findUnique({ where: { id: seriesBookings[4].id } });
    const b6 = await prisma.booking.findUnique({ where: { id: seriesBookings[5].id } });

    assert.notStrictEqual(b1?.status, BookingStatus.CANCELLED, 'Occurrence 1 must remain active');
    assert.notStrictEqual(b3?.status, BookingStatus.CANCELLED, 'Occurrence 3 must remain active');
    assert.strictEqual(b4?.status, BookingStatus.CANCELLED, 'Occurrence 4 must be cancelled');
    assert.strictEqual(b5?.status, BookingStatus.CANCELLED, 'Occurrence 5 must be cancelled');
    assert.strictEqual(b6?.status, BookingStatus.CANCELLED, 'Occurrence 6 must be cancelled');

    pass('Scope THIS_AND_FOLLOWING cancels target and subsequent dates, preserving prior dates');
  } catch (err) {
    fail('Scope THIS_AND_FOLLOWING cancellation', err);
  }

  // 5.4 Cancel scope: ENTIRE_SERIES
  try {
    const res = await fetch(`${BASE_URL}/api/bookings/series/${testSeriesId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        scope: 'ENTIRE_SERIES',
        reason: 'Cancelling entire series',
      }),
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.cancelledCount, 2, 'Should cancel remaining 2 active occurrences');

    const activeCount = await prisma.booking.count({
      where: { seriesId: testSeriesId, status: { not: BookingStatus.CANCELLED } },
    });
    assert.strictEqual(activeCount, 0, 'Zero active bookings should remain in series');
    pass('Scope ENTIRE_SERIES cancels all remaining active bookings in the series');
  } catch (err) {
    fail('Scope ENTIRE_SERIES cancellation', err);
  }
}

async function runIdempotencyTests() {
  console.log('\n--- SUITE 6: Series Idempotency Tests ---');

  try {
    const key = `r5-test-idempotent-${Date.now()}`;
    const seriesStartDate = getNextWeekdayDate('SATURDAY', 1);

    const payload = {
      resourceId: autoResource.id,
      frequency: 'WEEKLY',
      interval: 1,
      weekdays: ['SATURDAY'],
      startDate: seriesStartDate,
      count: 3,
      startTime: '15:00',
      durationMinutes: 60,
      expectedAttendance: 10,
      activityType: 'PROJECT_WORK',
      purpose: 'Idempotency Test Series',
      bookingMode: 'ATOMIC',
    };

    // First request
    const res1 = await fetch(`${BASE_URL}/api/bookings/series`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
        'Idempotency-Key': key,
      },
      body: JSON.stringify(payload),
    });
    const data1 = await res1.json();
    assert.ok(res1.status === 200 || res1.status === 201);
    assert.strictEqual(data1.successfulCount, 3);

    // Duplicate request with exact same idempotency key
    const res2 = await fetch(`${BASE_URL}/api/bookings/series`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
        'Idempotency-Key': key,
      },
      body: JSON.stringify(payload),
    });
    const data2 = await res2.json();
    assert.ok(res2.status === 200 || res2.status === 201);
    assert.strictEqual(data2.seriesId, data1.seriesId, 'Must return identical seriesId');
    assert.strictEqual(data2.successfulCount, 3);

    // Verify DB does not contain 6 bookings
    const totalBookings = await prisma.booking.count({
      where: { seriesId: data1.seriesId },
    });
    assert.strictEqual(totalBookings, 3, 'Must not duplicate bookings in DB');
    pass('Duplicate series request with same Idempotency-Key returns cached response without duplicate entries');
  } catch (err) {
    fail('Series idempotency test', err);
  }
}

async function runQuotaApiTests() {
  console.log('\n--- SUITE 7: Authoritative Weekly Quota API Tests ---');

  // 7.1 Student Quota Response Structure & Accuracy
  try {
    const res = await fetch(`${BASE_URL}/api/me/quota`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.ok(data.periodStart, 'Should have periodStart');
    assert.ok(data.periodEnd, 'Should have periodEnd');
    assert.strictEqual(typeof data.currentWeeklyHours, 'number');
    assert.strictEqual(typeof data.remainingWeeklyQuota, 'number');
    assert.strictEqual(typeof data.maxWeeklyHours, 'number');
    assert.strictEqual(data.role, 'STUDENT');
    assert.strictEqual(data.department, studentUser.department);
    assert.ok(data.policyName, 'Should include active policyName');

    // Week boundary test: start must be Monday, end must be Sunday
    const weekRange = getKolkataWeekRange(new Date());
    assert.strictEqual(data.periodStart, weekRange.weekStartStr, 'periodStart must match Monday in IST');
    assert.strictEqual(data.periodEnd, weekRange.weekEndStr, 'periodEnd must match Sunday in IST');
    pass('GET /api/me/quota returns authoritative student quota with exact Monday-Sunday IST boundaries');
  } catch (err) {
    fail('Student Quota API structure', err);
  }

  // 7.2 Faculty Quota Test
  try {
    const res = await fetch(`${BASE_URL}/api/me/quota`, {
      headers: { Authorization: `Bearer ${facultyToken}` },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.role, 'FACULTY');
    assert.ok(data.maxWeeklyHours >= 20, 'Faculty should have higher weekly quota');
    pass('GET /api/me/quota reflects faculty role policies correctly');
  } catch (err) {
    fail('Faculty Quota API', err);
  }
}

async function main() {
  try {
    await setup();
    await runRecurrenceEngineTests();
    await runPreviewApiTests();
    await runAtomicBookingTests();
    await runPartialBookingTests();
    await runCancellationTests();
    await runIdempotencyTests();
    await runQuotaApiTests();

    console.log('\n======================================================');
    console.log(`🏁 R5 TEST SUITE FINISHED: ${testPassed} PASSED, ${testFailed} FAILED`);
    console.log('======================================================\n');

    if (testFailed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  } finally {
    try {
      await cleanup();
    } catch {}
    await prisma.$disconnect();
  }
}

main();
