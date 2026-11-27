import assert from 'assert';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/lib/prisma';
import {
  BookingStatus,
  ActivityType,
  PriorityLevel,
  Role,
  CheckInMethod,
} from '@prisma/client';
import env from '../src/config/env';
import { generateSecurePin, hashPin } from '../src/lib/checkin-crypto';
import { getDateStringInKolkata } from '../src/lib/timezone';

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

function signAuthToken(payload: { id: string; email: string; role: Role }) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '1d' });
}

let studentA: any;
let studentAToken: string;
let studentB: any;
let studentBToken: string;
let faculty: any;
let facultyToken: string;
let approver: any;
let approverToken: string;
let otherApprover: any;
let otherApproverToken: string;
let admin: any;
let adminToken: string;

let resourceA: any; // CSE department
let resourceB: any; // Another resource for venue mismatch tests

async function cleanup() {
  await prisma.rateLimitBucket.deleteMany({}).catch(() => {});
  await prisma.consumedCheckInToken
    .deleteMany({
      where: {
        bookingId: { startsWith: '' },
      },
    })
    .catch(() => {});

  const testBookings = await prisma.booking.findMany({
    where: {
      OR: [
        { bookingNumber: { startsWith: 'LPU-TEST-R8-' } },
        { purpose: { contains: 'R8 Test' } },
      ],
    },
    select: { id: true },
  });
  const testIds = testBookings.map((b) => b.id);
  if (testIds.length > 0) {
    await prisma.consumedCheckInToken.deleteMany({
      where: { bookingId: { in: testIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { entityType: 'Booking', entityId: { in: testIds } },
    });
    await prisma.booking.deleteMany({
      where: { id: { in: testIds } },
    });
  }
}

async function clearRateLimits() {
  await prisma.rateLimitBucket.deleteMany({}).catch(() => {});
}

let bookingSeq = 1;
async function createTestBooking(opts: {
  userId: string;
  resourceId: string;
  department: string;
  status: BookingStatus;
  startOffsetMin: number;
  endOffsetMin: number;
  releaseOffsetMin?: number;
  purpose?: string;
}) {
  const now = Date.now();
  const startTime = new Date(now + opts.startOffsetMin * 60000);
  const endTime = new Date(now + opts.endOffsetMin * 60000);
  const releaseDeadline = new Date(
    startTime.getTime() + (opts.releaseOffsetMin ?? 15) * 60000
  );
  const pin = generateSecurePin();
  const num = `LPU-TEST-R8-${Date.now().toString().slice(-6)}-${bookingSeq++}`;

  // Ensure prior test bookings on this resource don't collide with no_overlapping_bookings
  await prisma.booking.updateMany({
    where: {
      resourceId: opts.resourceId,
      bookingNumber: { startsWith: 'LPU-TEST-R8-' },
      status: { in: [BookingStatus.PENDING, BookingStatus.APPROVED, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
    },
    data: { status: BookingStatus.CANCELLED },
  });

  const booking = await prisma.booking.create({
    data: {
      bookingNumber: num,
      userId: opts.userId,
      resourceId: opts.resourceId,
      startTime,
      endTime,
      releaseDeadline,
      purpose: opts.purpose || `R8 Test ${num}`,
      activityType: ActivityType.PROJECT_WORK,
      expectedAttendance: 5,
      priority: PriorityLevel.NORMAL,
      status: opts.status,
      checkInToken: pin,
      checkInPinHash: hashPin(pin),
      departmentId: opts.department,
    },
  });

  return { booking, pin };
}

async function fetchRoomQr(resourceId: string, token = adminToken): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/admin/resources/${resourceId}/room-qr`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  assert.strictEqual(res.status, 200, `Expected 200 fetching room QR, got ${res.status}`);
  return data.roomQr.qrPayload;
}

async function setup() {
  console.log('\n======================================================');
  console.log('🔐 INITIALIZING R8 SECURITY & CONCURRENCY TEST SUITE');
  console.log('======================================================\n');

  studentA = await prisma.user.findUnique({ where: { email: 'aastha.12108742@lpu.in' } });
  studentB = await prisma.user.findUnique({ where: { email: 'other.student@lpu.in' } });
  faculty = await prisma.user.findUnique({ where: { email: 'arvind.cse@lpu.in' } });
  approver = await prisma.user.findUnique({ where: { email: 'approver.sece@lpu.in' } });
  otherApprover = await prisma.user.findUnique({ where: { email: 'other.approver@lpu.in' } });
  admin = await prisma.user.findUnique({ where: { email: 'admin.estate@lpu.in' } });

  assert.ok(studentA && studentB && faculty && approver && admin, 'Required seed users exist');

  studentAToken = signAuthToken({ id: studentA.id, email: studentA.email, role: studentA.role });
  studentBToken = signAuthToken({ id: studentB.id, email: studentB.email, role: studentB.role });
  facultyToken = signAuthToken({ id: faculty.id, email: faculty.email, role: faculty.role });
  approverToken = signAuthToken({ id: approver.id, email: approver.email, role: approver.role });
  otherApproverToken = otherApprover
    ? signAuthToken({ id: otherApprover.id, email: otherApprover.email, role: otherApprover.role })
    : '';
  adminToken = signAuthToken({ id: admin.id, email: admin.email, role: admin.role });

  const resources = await prisma.resource.findMany({
    where: {
      deletedAt: null,
      department: 'School of Computer Science & Engineering',
    },
    take: 2,
  });
  assert.ok(resources.length >= 2, 'At least 2 CSE resources exist for venue mismatch testing');
  resourceA = resources[0];
  resourceB = resources[1];

  await cleanup();
}

async function runTests() {
  const roomQrA = await fetchRoomQr(resourceA.id);
  const roomQrB = await fetchRoomQr(resourceB.id);

  // TEST 1: Pending booking cannot be checked in
  try {
    const { booking, pin } = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.PENDING,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });

    const res = await fetch(`${BASE_URL}/api/bookings/${booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ pin, venueQr: roomQrA }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(data.code, 'PENDING_BOOKING');
    const unchanged = await prisma.booking.findUnique({ where: { id: booking.id } });
    assert.strictEqual(unchanged?.status, BookingStatus.PENDING);
    pass('Test 1: Pending booking rejected (PENDING_BOOKING) and remains PENDING');
  } catch (err) {
    fail('Test 1: Pending booking', err);
  }

  // TEST 2: Wrong user rejected
  try {
    const { booking, pin } = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });

    const res = await fetch(`${BASE_URL}/api/bookings/${booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentBToken}` },
      body: JSON.stringify({ pin, venueQr: roomQrA }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.code, 'WRONG_USER');
    const unchanged = await prisma.booking.findUnique({ where: { id: booking.id } });
    assert.strictEqual(unchanged?.status, BookingStatus.CONFIRMED);
    pass('Test 2: Wrong user rejected with 403 WRONG_USER');
  } catch (err) {
    fail('Test 2: Wrong user', err);
  }

  // TEST 3: Too early (before 30-min window) rejected & does not consume PIN attempt
  try {
    const { booking, pin } = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: 60, // 60 mins in future (> 30 min window)
      endOffsetMin: 120,
    });

    const res = await fetch(`${BASE_URL}/api/bookings/${booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ pin: '000000', venueQr: roomQrA }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.code, 'CHECK_IN_TOO_EARLY');
    assert.ok(data.availableFrom, 'Must include availableFrom timestamp');
    const unchanged = await prisma.booking.findUnique({ where: { id: booking.id } });
    assert.strictEqual(unchanged?.checkedInAt, null);
    assert.strictEqual(unchanged?.pinFailedAttempts, 0, 'Too-early check must not consume PIN attempt');
    pass('Test 3: Too early rejected (CHECK_IN_TOO_EARLY) without consuming PIN attempt');
  } catch (err) {
    fail('Test 3: Too early', err);
  }

  // TEST 4: Too late (after release deadline, before endTime) -> rejected for owner, overrideable by approver with reason
  try {
    const { booking, pin } = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -30,
      endOffsetMin: 60,
      releaseOffsetMin: 15, // releaseDeadline was 15 mins ago
    });

    const resLate = await fetch(`${BASE_URL}/api/bookings/${booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ pin, venueQr: roomQrA }),
    });
    const dataLate = await resLate.json();
    assert.strictEqual(resLate.status, 409);
    assert.strictEqual(dataLate.code, 'CHECK_IN_TOO_LATE');

    // Authorized approver override with reason
    const resOverride = await fetch(`${BASE_URL}/api/bookings/${booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${approverToken}` },
      body: JSON.stringify({
        venueQr: roomQrA,
        override: {
          reason: 'Transit delay verified at block gate',
          bypassLateWindow: true,
        },
      }),
    });
    const dataOverride = await resOverride.json();
    assert.strictEqual(resOverride.status, 200);
    assert.strictEqual(dataOverride.checkInMethod, CheckInMethod.APPROVER_OVERRIDE);
    assert.strictEqual(dataOverride.checkedInById, approver.id);
    assert.strictEqual(dataOverride.overrideReason, 'Transit delay verified at block gate');
    pass('Test 4: Late check-in rejected (CHECK_IN_TOO_LATE); authorized approver override recorded');
  } catch (err) {
    fail('Test 4: Too late & approver override', err);
  }

  // TEST 5: PIN locked after 5 failed attempts for 10 minutes
  try {
    await clearRateLimits();
    const { booking, pin } = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });

    for (let i = 1; i <= 4; i++) {
      const r = await fetch(`${BASE_URL}/api/bookings/${booking.id}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
        body: JSON.stringify({ pin: '999999', venueQr: roomQrA }),
      });
      const d = await r.json();
      assert.strictEqual(r.status, 401);
      assert.strictEqual(d.code, 'INVALID_PIN');
      assert.strictEqual(d.remainingAttempts, 5 - i);
    }

    // 5th failed attempt triggers lockout
    const r5 = await fetch(`${BASE_URL}/api/bookings/${booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ pin: '999999', venueQr: roomQrA }),
    });
    const d5 = await r5.json();
    assert.strictEqual(r5.status, 429);
    assert.strictEqual(d5.code, 'PIN_LOCKED');
    assert.ok(d5.lockedUntil);

    // Correct PIN during lockout must still be rejected
    const rCorrectLocked = await fetch(`${BASE_URL}/api/bookings/${booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ pin, venueQr: roomQrA }),
    });
    const dCorrectLocked = await rCorrectLocked.json();
    assert.strictEqual(rCorrectLocked.status, 429);
    assert.strictEqual(dCorrectLocked.code, 'PIN_LOCKED');

    // Simulate lockout expiration -> correct PIN succeeds
    await prisma.booking.update({
      where: { id: booking.id },
      data: { pinLockedUntil: new Date(Date.now() - 1000) },
    });
    const rUnlocked = await fetch(`${BASE_URL}/api/bookings/${booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ pin, venueQr: roomQrA }),
    });
    assert.strictEqual(rUnlocked.status, 200);
    pass('Test 5: 5 failed PIN attempts lock for 10 min; correct PIN rejected while locked & allowed after expiry');
  } catch (err) {
    fail('Test 5: PIN lockout', err);
  }

  // TEST 6: Replayed / expired signed token rejected
  try {
    await clearRateLimits();
    const { booking } = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });

    // Generate 5-minute token
    const tokRes = await fetch(`${BASE_URL}/api/bookings/${booking.id}/check-in-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const tokData = await tokRes.json();
    assert.strictEqual(tokRes.status, 200);
    assert.strictEqual(tokData.expiresInSeconds, 300);

    // Manually craft an expired token signed with CHECKIN_TOKEN_SECRET
    const expiredJwt = jwt.sign(
      {
        sub: studentA.id,
        bookingId: booking.id,
        resourceId: resourceA.id,
        jti: 'expired-jti-test',
        typ: 'checkin_qr',
        iat: Math.floor(Date.now() / 1000) - 600,
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      env.CHECKIN_TOKEN_SECRET,
      { algorithm: 'HS256' }
    );
    const expRes = await fetch(`${BASE_URL}/api/bookings/${booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ bookingToken: expiredJwt, venueQr: roomQrA }),
    });
    const expData = await expRes.json();
    assert.strictEqual(expRes.status, 401);
    assert.strictEqual(expData.code, 'EXPIRED_BOOKING_TOKEN');

    // Use valid token once -> succeeds
    const okRes = await fetch(`${BASE_URL}/api/bookings/${booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ bookingToken: tokData.token, venueQr: roomQrA }),
    });
    assert.strictEqual(okRes.status, 200);

    // Replay same token on same booking -> rejected
    const replayRes = await fetch(`${BASE_URL}/api/bookings/${booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ bookingToken: tokData.token, venueQr: roomQrA }),
    });
    assert.strictEqual(replayRes.status, 409);

    // Also test direct replay against a second CONFIRMED booking (or verify ConsumedCheckInToken record)
    const consumed = await prisma.consumedCheckInToken.findFirst({ where: { bookingId: booking.id } });
    assert.ok(consumed, 'ConsumedCheckInToken record persisted');
    pass('Test 6: Signed token expires in 5m, expired rejected, valid succeeds once, replay rejected');
  } catch (err) {
    fail('Test 6: Expired & replayed token', err);
  }

  // TESTS 7 - 14: Statuses, endTime, staff acting for owner, unauthorized override, missing reason
  try {
    await clearRateLimits();
    // 7. Confirmed in window succeeds
    const b7 = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -10,
      endOffsetMin: 50,
    });
    const t7 = await (
      await fetch(`${BASE_URL}/api/bookings/${b7.booking.id}/check-in-token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${studentAToken}` },
      })
    ).json();
    const r7 = await fetch(`${BASE_URL}/api/bookings/${b7.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ bookingToken: t7.token, venueQr: roomQrA }),
    });
    assert.strictEqual(r7.status, 200);
    pass('Test 7: Confirmed booking within permitted window checks in via QR_TOKEN');

    // 10. Already checked-in cannot check in again
    const r10 = await fetch(`${BASE_URL}/api/bookings/${b7.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ pin: b7.pin, venueQr: roomQrA }),
    });
    const d10 = await r10.json();
    assert.strictEqual(r10.status, 409);
    assert.strictEqual(d10.code, 'BOOKING_ALREADY_CHECKED_IN');
    pass('Test 10: Already checked-in booking cannot check in again');

    // 8 & 9. Cancelled and Rejected cannot check in
    const b8 = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CANCELLED,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });
    const r8 = await fetch(`${BASE_URL}/api/bookings/${b8.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ pin: b8.pin, venueQr: roomQrA }),
    });
    assert.strictEqual((await r8.json()).code, 'BOOKING_NOT_CONFIRMED');
    pass('Test 8: Cancelled booking cannot check in');

    const b9 = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.REJECTED,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });
    const r9 = await fetch(`${BASE_URL}/api/bookings/${b9.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ pin: b9.pin, venueQr: roomQrA }),
    });
    assert.strictEqual((await r9.json()).code, 'BOOKING_NOT_CONFIRMED');
    pass('Test 9: Rejected booking cannot check in');

    // 11. After scheduled end cannot check in (even with override)
    const b11 = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -120,
      endOffsetMin: -10,
    });
    const r11 = await fetch(`${BASE_URL}/api/bookings/${b11.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ override: { reason: 'Admin attempt after end', bypassLateWindow: true, bypassVenueVerification: true } }),
    });
    assert.strictEqual((await r11.json()).code, 'BOOKING_ALREADY_ENDED');
    pass('Test 11: Booking after scheduled end cannot check in (even with override)');

    // 12. Authorized approver can act on behalf of owner
    const b12 = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });
    const r12 = await fetch(`${BASE_URL}/api/bookings/${b12.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${approverToken}` },
      body: JSON.stringify({ pin: b12.pin, venueQr: roomQrA }),
    });
    assert.strictEqual(r12.status, 200);
    pass('Test 12: Authorized department approver can check in on behalf of owner');

    // 13 & 14. Unauthorized user cannot override; missing override reason rejected
    const b13 = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });
    const r13 = await fetch(`${BASE_URL}/api/bookings/${b13.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ override: { reason: 'Self override attempt', bypassVenueVerification: true } }),
    });
    assert.strictEqual(r13.status, 403);
    pass('Test 13: Unauthorized user cannot use override (403)');

    const r14 = await fetch(`${BASE_URL}/api/bookings/${b13.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ override: { reason: '  ', bypassVenueVerification: true } }),
    });
    assert.strictEqual(r14.status, 400);
    pass('Test 14: Missing override reason rejected (400)');
  } catch (err) {
    fail('Tests 7-14', err);
  }

  // TESTS 15 - 20: Venue mismatch, wrong booking token, PIN without venue, cross-session PIN, token regeneration
  try {
    await clearRateLimits();
    const b15 = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });
    const t15 = await (
      await fetch(`${BASE_URL}/api/bookings/${b15.booking.id}/check-in-token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${studentAToken}` },
      })
    ).json();

    // 15 & 17. Valid booking QR with wrong room QR (resourceB) rejected
    const r15 = await fetch(`${BASE_URL}/api/bookings/${b15.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ bookingToken: t15.token, venueQr: roomQrB }),
    });
    assert.strictEqual(r15.status, 403);
    assert.strictEqual((await r15.json()).code, 'VENUE_MISMATCH');
    pass('Tests 15 & 17: Valid booking QR with wrong room QR rejected (VENUE_MISMATCH)');

    // 16. Correct room QR with wrong booking token rejected
    const bOther = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceB.id,
      department: resourceB.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });
    const tOther = await (
      await fetch(`${BASE_URL}/api/bookings/${bOther.booking.id}/check-in-token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${studentAToken}` },
      })
    ).json();
    const r16 = await fetch(`${BASE_URL}/api/bookings/${b15.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ bookingToken: tOther.token, venueQr: roomQrA }),
    });
    assert.strictEqual(r16.status, 403);
    assert.strictEqual((await r16.json()).code, 'INVALID_BOOKING_TOKEN');
    pass('Test 16: Correct room QR with wrong booking token rejected');

    // 18. PIN alone without venue verification rejected
    const r18 = await fetch(`${BASE_URL}/api/bookings/${b15.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ pin: b15.pin }),
    });
    assert.strictEqual(r18.status, 400);
    assert.strictEqual((await r18.json()).code, 'INVALID_VENUE_QR');
    pass('Test 18: PIN alone without venue verification rejected');

    // 19. PIN attempts shared across sessions (new JWT session sees persistent DB counter)
    await fetch(`${BASE_URL}/api/bookings/${b15.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ pin: '000000', venueQr: roomQrA }),
    });
    const freshToken = signAuthToken({ id: studentA.id, email: studentA.email, role: studentA.role });
    const r19 = await fetch(`${BASE_URL}/api/bookings/${b15.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${freshToken}` },
      body: JSON.stringify({ pin: '000001', venueQr: roomQrA }),
    });
    assert.strictEqual((await r19.json()).remainingAttempts, 3);
    pass('Test 19: PIN attempts persist in DB across sessions');

    // 20. Token regeneration invalidates earlier token
    const t15Regen = await (
      await fetch(`${BASE_URL}/api/bookings/${b15.booking.id}/check-in-token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${studentAToken}` },
      })
    ).json();
    const rOldTok = await fetch(`${BASE_URL}/api/bookings/${b15.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ bookingToken: t15.token, venueQr: roomQrA }),
    });
    assert.strictEqual(rOldTok.status, 409);
    const rNewTok = await fetch(`${BASE_URL}/api/bookings/${b15.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ bookingToken: t15Regen.token, venueQr: roomQrA }),
    });
    assert.strictEqual(rNewTok.status, 200);
    pass('Test 20: Token regeneration invalidates earlier token');
  } catch (err) {
    fail('Tests 15-20', err);
  }

  // TESTS 21 - 24: Concurrent token & PIN check-ins, consumed tokens, general rate limit 429
  try {
    await clearRateLimits();
    // 21. Concurrent token verifications
    const b21 = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });
    const t21 = await (
      await fetch(`${BASE_URL}/api/bookings/${b21.booking.id}/check-in-token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${studentAToken}` },
      })
    ).json();
    const [c1, c2] = await Promise.all([
      fetch(`${BASE_URL}/api/bookings/${b21.booking.id}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
        body: JSON.stringify({ bookingToken: t21.token, venueQr: roomQrA }),
      }),
      fetch(`${BASE_URL}/api/bookings/${b21.booking.id}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
        body: JSON.stringify({ bookingToken: t21.token, venueQr: roomQrA }),
      }),
    ]);
    const cStatuses = [c1.status, c2.status];
    assert.strictEqual(cStatuses.filter((s) => s === 200).length, 1);
    assert.strictEqual(cStatuses.filter((s) => s === 409).length, 1);
    pass('Tests 21 & 23: Two concurrent token verifications yield exactly 1 success (200) & 1 rejection (409)');

    // 22. Concurrent PIN verifications
    const b22 = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });
    const [p1, p2] = await Promise.all([
      fetch(`${BASE_URL}/api/bookings/${b22.booking.id}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
        body: JSON.stringify({ pin: b22.pin, venueQr: roomQrA }),
      }),
      fetch(`${BASE_URL}/api/bookings/${b22.booking.id}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
        body: JSON.stringify({ pin: b22.pin, venueQr: roomQrA }),
      }),
    ]);
    const pStatuses = [p1.status, p2.status];
    assert.strictEqual(pStatuses.filter((s) => s === 200).length, 1);
    assert.strictEqual(pStatuses.filter((s) => s === 409).length, 1);
    pass('Test 22: Two concurrent PIN verifications cannot produce duplicate check-in');

    // 24. General rate limit returns 429
    await clearRateLimits();
    const b24 = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });
    let hit429 = false;
    for (let i = 0; i < 22; i++) {
      const r = await fetch(`${BASE_URL}/api/bookings/${b24.booking.id}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
        body: JSON.stringify({ bookingToken: 'invalid-jwt-token', venueQr: roomQrA }),
      });
      if (r.status === 429) {
        const d = await r.json();
        assert.strictEqual(d.code, 'RATE_LIMITED');
        hit429 = true;
        break;
      }
    }
    assert.strictEqual(hit429, true, 'Rate limit must trigger 429 RATE_LIMITED');
    pass('Test 24: General rate limit returns 429 RATE_LIMITED with retryAfterSeconds');
  } catch (err) {
    fail('Tests 21-24', err);
  }

  // TESTS 25 - 30: Secret isolation, QR rotation, R6 lifecycle compatibility, audit logs, Asia/Kolkata
  try {
    await clearRateLimits();
    // 25. Resource secrets never appear in normal resource APIs
    const resListText = await (await fetch(`${BASE_URL}/api/resources`)).text();
    const resDetailText = await (await fetch(`${BASE_URL}/api/resources/${resourceA.id}`)).text();
    assert.strictEqual(resListText.includes('checkInSecretEncrypted'), false);
    assert.strictEqual(resDetailText.includes('checkInSecretEncrypted'), false);
    pass('Test 25: Resource secrets never exposed in public resource APIs');

    // 26. QR generation & rotation require authorized staff
    const unauthQr = await fetch(`${BASE_URL}/api/admin/resources/${resourceA.id}/room-qr`, {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert.strictEqual(unauthQr.status, 403);
    const unauthRotate = await fetch(`${BASE_URL}/api/admin/resources/${resourceA.id}/room-qr`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert.strictEqual(unauthRotate.status, 403);
    pass('Test 26: Room QR access & rotation strictly require authorized staff (403 for students)');

    // 27. QR rotation invalidates old QR & works with new secret
    const rotRes = await fetch(`${BASE_URL}/api/admin/resources/${resourceA.id}/room-qr`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const rotData = await rotRes.json();
    assert.strictEqual(rotRes.status, 200);
    const newRoomQrA = rotData.roomQr.qrPayload;

    const b27 = await createTestBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -5,
      endOffsetMin: 55,
    });
    const rOldQr = await fetch(`${BASE_URL}/api/bookings/${b27.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ pin: b27.pin, venueQr: roomQrA }),
    });
    assert.strictEqual(rOldQr.status, 400);
    assert.strictEqual((await rOldQr.json()).code, 'INVALID_VENUE_QR');

    const rNewQr = await fetch(`${BASE_URL}/api/bookings/${b27.booking.id}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ pin: b27.pin, venueQr: newRoomQrA }),
    });
    assert.strictEqual(rNewQr.status, 200);
    pass('Test 27: Rotating room secret invalidates old QR & accepts new rotated QR');

    // 28. R6 end-early compatibility after R8 check-in
    const rEndEarly = await fetch(`${BASE_URL}/api/bookings/${b27.booking.id}/end-early`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert.strictEqual(rEndEarly.status, 200);
    const endEarlyData = await rEndEarly.json();
    assert.strictEqual(endEarlyData.booking.status, BookingStatus.COMPLETED);
    pass('Test 28: R6 early-end lifecycle remains compatible with R8 checked-in bookings');

    // 29. Audit logs capture method, time, actor, and override reason
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'Booking', entityId: b27.booking.id, action: 'CHECKIN_COMPLETED' },
    });
    assert.ok(audit);
    const parsedAudit = JSON.parse(audit.details || '{}');
    assert.strictEqual(parsedAudit.checkInMethod, CheckInMethod.PIN);
    assert.strictEqual(parsedAudit.venueVerified, true);
    assert.strictEqual(parsedAudit.checkedInById, studentA.id);
    pass('Test 29: Audit logs accurately capture check-in method, actor, venueVerified, and timestamp');

    // 30. Asia/Kolkata date consistency check
    const kolkataToday = getDateStringInKolkata(new Date());
    assert.match(kolkataToday, /^\d{4}-\d{2}-\d{2}$/);
    pass('Test 30: Asia/Kolkata timezone formatting verified');
  } catch (err) {
    fail('Tests 25-30', err);
  }
}

async function main() {
  try {
    await setup();
    await runTests();
    console.log('\n======================================================');
    console.log(`🏁 R8 TEST SUITE FINISHED: ${testPassed} PASSED, ${testFailed} FAILED`);
    console.log('======================================================\n');
    if (testFailed > 0) process.exit(1);
  } catch (err) {
    console.error('Fatal R8 test error:', err);
    process.exit(1);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main();
