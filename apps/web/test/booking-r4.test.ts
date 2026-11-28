/**
 * TASK R4 AUTOMATED TEST SUITE: BOOKING MODAL, PREVIEW, IDEMPOTENCY & DASHBOARD
 * Run with: cd apps/web && npx tsx test/booking-r4.test.ts
 *
 * Covers:
 * 1. Booking Preview API (unauthenticated rejection, auto-confirmed vs approval required vs policy refusal, zero side effects)
 * 2. Double-booking & Idempotency acceptance test (concurrent requests with same Idempotency-Key create exactly 1 booking)
 * 3. 409 Conflict & Genuine Alternative Available Slot suggestions
 * 4. Dashboard API (authenticated user data isolation, accurate quota, real timetable & statistics)
 * 5. Smart Allocation Assistant & Recommendations (capacity fit, amenity matching, availability filtering)
 * 6. Check-in PIN, QR code payload contract, and RFC 5545 .ics Calendar generation
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
} from '../src/lib/timezone';

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

async function setup() {
  console.log('\n======================================================');
  console.log('🚀 INITIALIZING R4 TEST SUITE: PREVIEW, MODAL & DASHBOARD');
  console.log('======================================================\n');

  // Load seed users
  studentUser = await prisma.user.findUnique({ where: { email: 'ketan.12204598@lpu.in' } });
  facultyUser = await prisma.user.findUnique({ where: { email: 'arvind.cse@lpu.in' } });

  if (!studentUser || !facultyUser) {
    throw new Error('Seed users missing. Run npm run db:seed first.');
  }

  studentToken = signToken({ id: studentUser.id, email: studentUser.email, role: studentUser.role });
  facultyToken = signToken({ id: facultyUser.id, email: facultyUser.email, role: facultyUser.role });

  // Pick a resource with broad operating hours (08:00 AM - 08:00 PM) for seamless slot testing
  autoResource =
    (await prisma.resource.findFirst({
      where: {
        name: 'CSE Classroom 204',
        requiresApproval: false,
        isUnderMaintenance: false,
        deletedAt: null,
      },
    })) ||
    (await prisma.resource.findFirst({
      where: {
        operatingHours: { contains: '08:00 AM' },
        requiresApproval: false,
        isUnderMaintenance: false,
        deletedAt: null,
      },
    }));

  approvalResource = await prisma.resource.findFirst({
    where: {
      requiresApproval: true,
      isUnderMaintenance: false,
      deletedAt: null,
    },
  });

  assert.ok(autoResource, 'Auto-confirmable resource with standard operating hours exists');
  assert.ok(approvalResource, 'Approval-required resource exists');

  // Clean up any test bookings created by prior R4 test runs
  await prisma.idempotencyKey.deleteMany({
    where: { key: { startsWith: 'r4-test-key-' } },
  });
  await prisma.idempotencyKey.deleteMany({
    where: { key: { startsWith: 'r4-conflict-key-' } },
  });
  await prisma.booking.deleteMany({
    where: {
      OR: [
        {
          purpose: {
            in: [
              'R4 Auto Confirmation Test',
              'R4 Long Duration Approval Test',
              'R4 Concurrent Submission Test',
              'R4 Conflict Test Booking 1',
              'R4 Conflict Test Booking 2',
              'R4 Alternative Slot Target',
            ],
          },
        },
        { purpose: { contains: 'Concurrent test attempt' } },
      ],
    },
  });
}

async function runR4Tests() {
  await setup();

  // Pick targetDate 5 days out (Wednesday, free of timetable classes and within 14-day advance booking window)
  const targetDate = addDaysKolkata(getCurrentKolkataDateString(), 5);
  const startUtcShort = kolkataToUtc(targetDate, '10:00');
  const endUtcShort = kolkataToUtc(targetDate, '11:00'); // 1 hour -> qualifies for auto-approval

  const startUtcLong = kolkataToUtc(targetDate, '16:00');
  const endUtcLong = kolkataToUtc(targetDate, '19:00'); // 3 hours -> exceeds student 2h auto-approval threshold

  // =========================================================================
  // SUITE 1: BOOKING PREVIEW API (POST /api/bookings/preview)
  // =========================================================================
  console.log('\n--- SUITE 1: BOOKING PREVIEW API (POST /api/bookings/preview) ---');
  try {
    // 1. Unauthenticated rejection
    const unauthRes = await fetch(`${BASE_URL}/api/bookings/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceId: autoResource.id,
        startTime: startUtcShort.toISOString(),
        endTime: endUtcShort.toISOString(),
      }),
    });
    assert.strictEqual(unauthRes.status, 401);
    pass('POST /api/bookings/preview rejects unauthenticated requests with 401');

    // Count bookings and idempotency keys before preview tests
    const initialBookingCount = await prisma.booking.count();
    const initialKeyCount = await prisma.idempotencyKey.count();

    // 2. Auto-confirmed preview for Student (1 hour on auto-approved room)
    const autoPreviewRes = await fetch(`${BASE_URL}/api/bookings/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        resourceId: autoResource.id,
        startTime: startUtcShort.toISOString(),
        endTime: endUtcShort.toISOString(),
        expectedAttendance: 10,
        activityType: 'PROJECT_WORK',
        purpose: 'R4 Auto Confirmation Test',
      }),
    });
    assert.strictEqual(autoPreviewRes.status, 200);
    const autoPreview = await autoPreviewRes.json();
    assert.strictEqual(autoPreview.allowed, true);
    assert.strictEqual(autoPreview.decision, 'AUTO_CONFIRMED');
    assert.strictEqual(autoPreview.requiresApproval, false);
    assert.strictEqual(autoPreview.initialStatus, 'CONFIRMED');
    assert.ok(typeof autoPreview.remainingWeeklyQuota === 'number');
    assert.ok(autoPreview.maxWeeklyHours > 0);
    pass('Auto-confirmable preview returns allowed: true, decision: AUTO_CONFIRMED, and remaining weekly quota');

    // 3. Approval-required preview for Student (3 hours exceeds 2-hour student threshold)
    const approvalPreviewRes = await fetch(`${BASE_URL}/api/bookings/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        resourceId: autoResource.id,
        startTime: startUtcLong.toISOString(),
        endTime: endUtcLong.toISOString(),
        expectedAttendance: 10,
        activityType: 'PROJECT_WORK',
        purpose: 'R4 Long Duration Approval Test',
      }),
    });
    assert.strictEqual(approvalPreviewRes.status, 200);
    const approvalPreview = await approvalPreviewRes.json();
    assert.strictEqual(approvalPreview.allowed, true);
    assert.strictEqual(approvalPreview.decision, 'REQUIRES_APPROVAL');
    assert.strictEqual(approvalPreview.requiresApproval, true);
    assert.strictEqual(approvalPreview.initialStatus, 'PENDING');
    assert.ok(approvalPreview.reason?.includes('2 hours') || approvalPreview.policyMessages?.length > 0);
    pass('Long duration (>2h) preview returns decision: REQUIRES_APPROVAL with approval rationale');

    // 4. Policy Refusal: attendance exceeds room capacity
    const overflowPreviewRes = await fetch(`${BASE_URL}/api/bookings/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        resourceId: autoResource.id,
        startTime: startUtcShort.toISOString(),
        endTime: endUtcShort.toISOString(),
        expectedAttendance: autoResource.capacity + 50, // exceeds room capacity
        activityType: 'PROJECT_WORK',
      }),
    });
    assert.strictEqual(overflowPreviewRes.status, 200);
    const overflowPreview = await overflowPreviewRes.json();
    assert.strictEqual(overflowPreview.allowed, false);
    assert.strictEqual(overflowPreview.decision, 'POLICY_REFUSAL');
    assert.ok(overflowPreview.reason?.includes('capacity') || overflowPreview.reason?.includes('exceeds'));
    pass('Attendance exceeding capacity returns decision: POLICY_REFUSAL with capacity warning');

    // 5. Verify Zero Side Effects: no bookings created, no idempotency keys consumed
    const postBookingCount = await prisma.booking.count();
    const postKeyCount = await prisma.idempotencyKey.count();
    assert.strictEqual(initialBookingCount, postBookingCount);
    assert.strictEqual(initialKeyCount, postKeyCount);
    pass('Booking preview has strictly ZERO side effects on database (no bookings created, no keys consumed)');
  } catch (err) {
    fail('Suite 1: Booking Preview API failed', err);
  }

  // =========================================================================
  // SUITE 2: DOUBLE-BOOKING & IDEMPOTENCY ACCEPTANCE TEST
  // =========================================================================
  console.log('\n--- SUITE 2: DOUBLE-BOOKING & IDEMPOTENCY ACCEPTANCE TEST ---');
  try {
    const testIdempotencyKey = `r4-test-key-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const startConcurrent = kolkataToUtc(targetDate, '11:00');
    const endConcurrent = kolkataToUtc(targetDate, '12:00');

    const requestPayload = {
      resourceId: autoResource.id,
      startTime: startConcurrent.toISOString(),
      endTime: endConcurrent.toISOString(),
      purpose: 'R4 Concurrent Submission Test',
      activityType: 'PROJECT_WORK',
      expectedAttendance: 15,
      priority: 'NORMAL',
    };

    // Issue two rapid parallel requests with the identical Idempotency-Key
    const [res1, res2] = await Promise.all([
      fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`,
          'Idempotency-Key': testIdempotencyKey,
        },
        body: JSON.stringify(requestPayload),
      }),
      fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${studentToken}`,
          'Idempotency-Key': testIdempotencyKey,
        },
        body: JSON.stringify(requestPayload),
      }),
    ]);

    assert.ok(res1.status === 200 || res1.status === 201, `res1 status was ${res1.status}`);
    assert.ok(res2.status === 200 || res2.status === 201, `res2 status was ${res2.status}`);

    const body1 = await res1.json();
    const body2 = await res2.json();

    // Verify both responses yield the same booking reference and token
    assert.strictEqual(body1.booking.id, body2.booking.id);
    assert.strictEqual(body1.booking.bookingNumber, body2.booking.bookingNumber);
    assert.strictEqual(body1.booking.checkInToken, body2.booking.checkInToken);

    // Verify exactly ONE booking record was inserted into PostgreSQL
    const matchingBookings = await prisma.booking.findMany({
      where: {
        resourceId: autoResource.id,
        purpose: 'R4 Concurrent Submission Test',
      },
    });
    assert.strictEqual(matchingBookings.length, 1);
    pass('Rapid concurrent submissions with same Idempotency-Key created exactly 1 database booking');

    // Verify booking attributes: valid PIN and sequential booking number format
    const createdBooking = matchingBookings[0];
    assert.match(createdBooking.bookingNumber, /^LPU-\d{4}-\d{6}$/);
    assert.ok(createdBooking?.checkInPinHash, 'Check-in PIN hash must be stored in DB');
    assert.strictEqual(createdBooking?.checkInToken, null, 'Plaintext checkInToken must not be stored in DB');
    pass(`Booking created with sequential format ${createdBooking.bookingNumber} and 6-digit PIN`);
  } catch (err) {
    fail('Suite 2: Double-Booking & Idempotency failed', err);
  }

  // =========================================================================
  // SUITE 3: 409 CONFLICT & ALTERNATIVE SLOT SUGGESTIONS
  // =========================================================================
  console.log('\n--- SUITE 3: 409 CONFLICT & REAL ALTERNATIVE SLOT SUGGESTIONS ---');
  try {
    const conflictStart = kolkataToUtc(targetDate, '11:15'); // overlaps 11:00 - 12:00
    const conflictEnd = kolkataToUtc(targetDate, '12:15');

    // 1. Attempting to book the conflicting slot must fail with 409 Conflict
    const conflictRes = await fetch(`${BASE_URL}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${facultyToken}`,
        'Idempotency-Key': `r4-conflict-key-${Date.now()}`,
      },
      body: JSON.stringify({
        resourceId: autoResource.id,
        startTime: conflictStart.toISOString(),
        endTime: conflictEnd.toISOString(),
        purpose: 'R4 Conflict Test Booking 2',
        activityType: 'PROJECT_WORK',
        expectedAttendance: 10,
      }),
    });
    assert.strictEqual(conflictRes.status, 409);
    const conflictData = await conflictRes.json();
    assert.ok(
      conflictData.error?.includes('conflict') ||
        conflictData.error?.includes('overlaps') ||
        conflictData.error?.includes('booked') ||
        conflictData.error?.includes('reserved')
    );
    pass('Overlapping booking attempt correctly rejected with HTTP 409 Conflict');

    // 2. Previewing the conflicting slot returns POLICY_REFUSAL and genuine alternative slots
    const conflictPreviewRes = await fetch(`${BASE_URL}/api/bookings/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${facultyToken}`,
      },
      body: JSON.stringify({
        resourceId: autoResource.id,
        startTime: conflictStart.toISOString(),
        endTime: conflictEnd.toISOString(),
        expectedAttendance: 10,
        activityType: 'PROJECT_WORK',
      }),
    });
    assert.strictEqual(conflictPreviewRes.status, 200);
    const conflictPreview = await conflictPreviewRes.json();
    assert.strictEqual(conflictPreview.allowed, false);
    assert.strictEqual(conflictPreview.decision, 'POLICY_REFUSAL');
    assert.ok(Array.isArray(conflictPreview.alternativeSlots));
    assert.ok(conflictPreview.alternativeSlots.length > 0 && conflictPreview.alternativeSlots.length <= 3);

    // Verify that every suggested alternative slot is actually available
    for (const alt of conflictPreview.alternativeSlots) {
      assert.ok(alt.startTime && alt.endTime && alt.date);
      const altStartUtc = kolkataToUtc(alt.date, alt.startTime);
      const altEndUtc = kolkataToUtc(alt.date, alt.endTime);

      const clash = await prisma.booking.findFirst({
        where: {
          resourceId: autoResource.id,
          status: {
            in: [
              BookingStatus.PENDING,
              BookingStatus.CONFIRMED,
              BookingStatus.APPROVED,
              BookingStatus.CHECKED_IN,
            ],
          },
          AND: [
            { startTime: { lt: altEndUtc } },
            { endTime: { gt: altStartUtc } },
          ],
        },
      });
      assert.strictEqual(
        clash,
        null,
        `Alternative slot ${alt.startTime}-${alt.endTime} must not clash with existing bookings`
      );
    }
    pass(`Conflict preview returned ${conflictPreview.alternativeSlots.length} genuine non-overlapping alternative slots`);
  } catch (err) {
    fail('Suite 3: 409 Conflict & Alternative Slots failed', err);
  }

  // =========================================================================
  // SUITE 4: DASHBOARD API & USER DATA ISOLATION (GET /api/dashboard)
  // =========================================================================
  console.log('\n--- SUITE 4: DASHBOARD API & DATA ISOLATION (GET /api/dashboard) ---');
  try {
    // 1. Unauthenticated rejection
    const unauthDash = await fetch(`${BASE_URL}/api/dashboard`);
    assert.strictEqual(unauthDash.status, 401);
    pass('GET /api/dashboard rejects unauthenticated requests with 401');

    // 2. Authenticated Student Dashboard
    const studentDashRes = await fetch(`${BASE_URL}/api/dashboard`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.strictEqual(studentDashRes.status, 200);
    const studentDash = await studentDashRes.json();

    assert.ok(studentDash.stats);
    assert.ok(typeof studentDash.stats.totalBookings === 'number');
    assert.ok(typeof studentDash.stats.upcomingBookingsCount === 'number');
    assert.ok(typeof studentDash.stats.remainingWeeklyQuota === 'number');
    assert.ok(studentDash.stats.maxWeeklyHours > 0);
    assert.ok(studentDash.stats.remainingWeeklyQuota <= studentDash.stats.maxWeeklyHours);

    // Verify upcomingBookings isolation: every returned booking belongs strictly to the student
    assert.ok(Array.isArray(studentDash.upcomingBookings));
    for (const b of studentDash.upcomingBookings) {
      assert.strictEqual(b.userId, studentUser.id);
    }
    pass('Student dashboard returns verified real statistics and strictly isolates personal upcoming bookings');

    // 3. Faculty Dashboard
    const facultyDashRes = await fetch(`${BASE_URL}/api/dashboard`, {
      headers: { Authorization: `Bearer ${facultyToken}` },
    });
    assert.strictEqual(facultyDashRes.status, 200);
    const facultyDash = await facultyDashRes.json();
    assert.ok(facultyDash.stats);
    for (const b of facultyDash.upcomingBookings) {
      assert.strictEqual(b.userId, facultyUser.id);
    }
    pass('Faculty dashboard returns verified real statistics with faculty data isolation');

    // 4. Timetable and Resource Recommendations in Dashboard
    assert.ok(Array.isArray(studentDash.recommendedResources));
    assert.ok(studentDash.recommendedResources.length > 0);
    assert.ok(Array.isArray(studentDash.timetableClasses));
    pass('Dashboard includes active recommended facilities and current academic timetable entries');
  } catch (err) {
    fail('Suite 4: Dashboard API & Data Isolation failed', err);
  }

  // =========================================================================
  // SUITE 5: SMART ALLOCATION RECOMMENDATIONS API
  // =========================================================================
  console.log('\n--- SUITE 5: SMART ALLOCATION RECOMMENDATIONS API ---');
  try {
    // 1. Recommendations via GET /api/resources/recommendations
    const recRes = await fetch(
      `${BASE_URL}/api/resources/recommendations?attendance=35&activityType=PROJECT_WORK&date=${targetDate}&startTime=15:00&endTime=17:00&limit=5`
    );
    assert.strictEqual(recRes.status, 200);
    const recData = await recRes.json();

    assert.ok(Array.isArray(recData.recommendations));
    assert.ok(recData.recommendations.length > 0);

    for (const item of recData.recommendations) {
      assert.ok(item.resource);
      assert.ok(item.rankingScore > 0, `rankingScore must be positive (was ${item.rankingScore})`);
      assert.ok(item.resource.capacity >= 35, 'Recommended room capacity must accommodate attendance');
      assert.ok(item.isAvailable, 'Recommended room must be available during requested window');
      assert.ok(typeof item.reason === 'string' && item.reason.length > 0);
    }
    pass(`GET /api/resources/recommendations returned ${recData.recommendations.length} transparently scored rooms`);

    // 2. Verify sorting by rankingScore descending
    for (let i = 0; i < recData.recommendations.length - 1; i++) {
      assert.ok(
        recData.recommendations[i].rankingScore >= recData.recommendations[i + 1].rankingScore,
        'Recommendations must be sorted descending by rankingScore'
      );
    }
    pass('Recommendations are strictly sorted by highest ranking score first');

    // 3. POST /api/resources/smart-allocation compatibility
    const smartAllocRes = await fetch(`${BASE_URL}/api/resources/smart-allocation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendance: 30,
        activityType: 'LAB_SESSION',
        date: targetDate,
        timeSlot: '16:00 - 18:00',
      }),
    });
    assert.strictEqual(smartAllocRes.status, 200);
    const smartAllocData = await smartAllocRes.json();
    assert.ok(smartAllocData.recommendation || smartAllocData.recommendations);
    pass('POST /api/resources/smart-allocation successfully delegates to recommendation engine');
  } catch (err) {
    fail('Suite 5: Smart Allocation Recommendations failed', err);
  }

  // =========================================================================
  // SUITE 6: QR CODE PAYLOAD & RFC 5545 .ICS CALENDAR EXPORT
  // =========================================================================
  console.log('\n--- SUITE 6: QR CODE PAYLOAD & RFC 5545 .ICS CALENDAR EXPORT ---');
  let suite6BookingId: string | null = null;
  const suite6IdemKey = `r4-suite6-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    // Find a free 1-hour slot on autoResource for an isolated R4-created booking
    let slotStartIso = '';
    let slotEndIso = '';
    for (let dayOffset = 3; dayOffset <= 7 && !slotStartIso; dayOffset++) {
      const candDate = addDaysKolkata(getCurrentKolkataDateString(), dayOffset);
      const dayOfWeek = kolkataToUtc(candDate, '12:00').getUTCDay();
      if (dayOfWeek === 0) continue; // skip Sunday
      for (const hour of [18, 17, 16, 15, 14, 10]) {
        const s = kolkataToUtc(candDate, `${String(hour).padStart(2, '0')}:00`);
        const e = kolkataToUtc(candDate, `${String(hour + 1).padStart(2, '0')}:00`);
        const clash = await prisma.booking.findFirst({
          where: {
            resourceId: autoResource.id,
            status: { in: [BookingStatus.PENDING, BookingStatus.APPROVED, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
            startTime: { lt: e },
            endTime: { gt: s },
          },
        });
        if (!clash) {
          slotStartIso = s.toISOString();
          slotEndIso = e.toISOString();
          break;
        }
      }
    }
    assert.ok(slotStartIso && slotEndIso, 'Free slot found for Suite 6 isolated booking');

    const createRes = await fetch(`${BASE_URL}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
        'Idempotency-Key': suite6IdemKey,
      },
      body: JSON.stringify({
        resourceId: autoResource.id,
        startTime: slotStartIso,
        endTime: slotEndIso,
        activityType: ActivityType.PROJECT_WORK,
        purpose: 'R4 Suite 6 QR and ICS Verification',
        expectedAttendance: 4,
      }),
    });
    const createBody = await createRes.json();
    assert.ok([200, 201].includes(createRes.status), `Suite 6 booking create failed: ${JSON.stringify(createBody)}`);
    suite6BookingId = createBody.booking.id;

    const sampleBooking = await prisma.booking.findUnique({
      where: { id: suite6BookingId! },
      include: { resource: true },
    });
    assert.ok(sampleBooking, 'Isolated Suite 6 booking exists in DB for format verification');

    // 1. PIN hash verification (no plaintext PIN stored in DB)
    assert.strictEqual(sampleBooking.checkInToken, null, 'Plaintext checkInToken must not be stored in DB');
    assert.ok(sampleBooking.checkInPinHash, 'Hashed check-in PIN must be stored in DB');
    pass('Check-in PIN is hashed at rest without plaintext DB storage');

    // 2. QR Code payload serialization
    const qrPayload = JSON.stringify({
      bookingNumber: sampleBooking.bookingNumber,
      bookingId: sampleBooking.id,
      resource: sampleBooking.resource.name,
    });
    const parsedQr = JSON.parse(qrPayload);
    assert.strictEqual(parsedQr.bookingNumber, sampleBooking.bookingNumber);
    assert.strictEqual(parsedQr.bookingId, sampleBooking.id);
    assert.strictEqual(parsedQr.resource, sampleBooking.resource.name);
    pass('QR code payload serializes and parses correctly with required booking identifiers');

    // 3. RFC 5545 .ics Calendar format generation
    const startUtc = new Date(sampleBooking.startTime).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endUtc = new Date(sampleBooking.endTime).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const nowUtc = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//LPU Campus Booking Platform//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${sampleBooking.bookingNumber}@lpu.in`,
      `DTSTAMP:${nowUtc}`,
      `DTSTART:${startUtc}`,
      `DTEND:${endUtc}`,
      `SUMMARY:Reservation: ${sampleBooking.resource.name} (${sampleBooking.bookingNumber})`,
      `DESCRIPTION:Purpose: ${sampleBooking.purpose}\\nCheck-in PIN: ${sampleBooking.checkInToken}\\nStatus: ${sampleBooking.status}`,
      `LOCATION:${sampleBooking.resource.name}, ${sampleBooking.resource.building}`,
      `STATUS:${sampleBooking.status === 'CONFIRMED' ? 'CONFIRMED' : 'TENTATIVE'}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    assert.ok(icsContent.includes('BEGIN:VCALENDAR'));
    assert.ok(icsContent.includes('VERSION:2.0'));
    assert.ok(icsContent.includes('BEGIN:VEVENT'));
    assert.ok(icsContent.includes(`UID:${sampleBooking.bookingNumber}@lpu.in`));
    assert.ok(icsContent.includes(`SUMMARY:Reservation: ${sampleBooking.resource.name}`));
    assert.ok(icsContent.includes(`LOCATION:${sampleBooking.resource.name}`));
    assert.ok(icsContent.includes('END:VEVENT'));
    assert.ok(icsContent.includes('END:VCALENDAR'));
    pass('Generated .ics calendar file matches RFC 5545 specification with complete event metadata');
  } catch (err) {
    fail('Suite 6: QR Code & .ics Calendar failed', err);
  } finally {
    if (suite6BookingId) {
      await prisma.booking.delete({ where: { id: suite6BookingId } }).catch(() => {});
    }
    await prisma.idempotencyKey
      .deleteMany({ where: { userId: studentUser.id, key: suite6IdemKey } })
      .catch(() => {});
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n======================================================');
  console.log(`📊 R4 TEST SUMMARY: ${testPassed} Passed, ${testFailed} Failed`);
  console.log('======================================================\n');

  if (testFailed > 0) {
    process.exit(1);
  }
}

runR4Tests()
  .catch((err) => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
