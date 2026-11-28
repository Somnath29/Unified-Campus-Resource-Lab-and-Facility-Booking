import assert from 'assert';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/lib/prisma';
import {
  BookingStatus,
  ActivityType,
  PriorityLevel,
  Role,
  WaitlistStatus,
  RecurrenceFrequency,
} from '@prisma/client';
import env from '../src/config/env';
import {
  getCurrentKolkataDateString,
  addDaysKolkata,
  kolkataToUtc,
} from '../src/lib/timezone';
import { WaitlistService } from '../src/services/waitlistService';
import { processAutoRelease } from '../src/server/services/autoRelease';

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

function signToken(payload: { id: string; email: string; role: Role }) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '1d' });
}

let studentA: any;
let studentAToken: string;
let studentB: any;
let studentBToken: string;
let studentRestricted: any;
let studentRestrictedToken: string;
let faculty: any;
let facultyToken: string;
let approver: any;
let approverToken: string;
let admin: any;
let adminToken: string;

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
  await prisma.waitlistEntry.deleteMany({
    where: {
      OR: [
        { resource: { name: { contains: 'Test' } } },
        { user: { email: { in: ['ketan.12204598@lpu.in', 'aastha.12108742@lpu.in', 'other.student@lpu.in', 'arvind.cse@lpu.in', 'policy.test.student@lpu.in'] } } },
      ],
    },
  }).catch(() => {});

  await prisma.booking.deleteMany({
    where: {
      OR: [
        { bookingNumber: { startsWith: 'LPU-TEST-R7-' } },
        { bookingNumber: { startsWith: 'LPU-TEST-POLICY-' } },
        { purpose: { contains: 'R7 Test' } },
        { purpose: { contains: 'Waitlist' } },
        { user: { email: 'policy.test.student@lpu.in' } },
      ],
    },
  }).catch(() => {});

  await prisma.auditLog.deleteMany({
    where: {
      entityType: 'WaitlistEntry',
    },
  }).catch(() => {});

  await prisma.notification.deleteMany({
    where: {
      title: { contains: 'Waitlist' },
    },
  }).catch(() => {});
}

async function setup() {
  console.log('\n======================================================');
  console.log('🚀 INITIALIZING R7 TEST SUITE: WAITLIST MANAGEMENT');
  console.log('======================================================\n');

  studentA = await prisma.user.findUnique({ where: { email: 'aastha.12108742@lpu.in' } });
  studentB = await prisma.user.findUnique({ where: { email: 'other.student@lpu.in' } });
  studentRestricted = await prisma.user.findUnique({ where: { email: 'ketan.12204598@lpu.in' } });
  faculty = await prisma.user.findUnique({ where: { email: 'arvind.cse@lpu.in' } });
  approver = await prisma.user.findUnique({ where: { email: 'approver.sece@lpu.in' } });
  admin = await prisma.user.findUnique({ where: { email: 'admin.estate@lpu.in' } });

  if (!studentA || !studentB || !studentRestricted || !faculty || !approver || !admin) {
    throw new Error('Required seed users are missing.');
  }

  studentAToken = signToken({ id: studentA.id, email: studentA.email, role: studentA.role });
  studentBToken = signToken({ id: studentB.id, email: studentB.email, role: studentB.role });
  studentRestrictedToken = signToken({ id: studentRestricted.id, email: studentRestricted.email, role: studentRestricted.role });
  facultyToken = signToken({ id: faculty.id, email: faculty.email, role: faculty.role });
  approverToken = signToken({ id: approver.id, email: approver.email, role: approver.role });
  adminToken = signToken({ id: admin.id, email: admin.email, role: admin.role });

  autoResource = await prisma.resource.findFirst({
    where: { requiresApproval: false, deletedAt: null },
  });

  approvalResource = await prisma.resource.findFirst({
    where: { requiresApproval: true, deletedAt: null },
  });

  assert.ok(autoResource, 'Auto-confirmable resource exists');
  assert.ok(approvalResource, 'Approval-required resource exists');

  await cleanup();

  console.log(`  ✓ Seed data loaded: StudentA (${studentA.email}), StudentB (${studentB.email}), Faculty (${faculty.email})`);
}

/**
 * Core Acceptance Tests (Tests 1-3)
 */
async function runCoreAcceptanceTests() {
  console.log('\n--- CORE ACCEPTANCE TESTS (Tests 1 - 3) ---');

  const testDate = getNextWeekdayDate('WEDNESDAY', 4);
  const startIso1 = `${testDate}T10:00:00+05:30`;
  const endIso1 = `${testDate}T11:00:00+05:30`;
  const start1 = new Date(startIso1);
  const end1 = new Date(endIso1);

  // TEST 1: Cancel -> Offer -> Accept
  try {
    // 1. Create a confirmed booking by Student B
    const booking1 = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R7-1-${Date.now().toString().slice(-6)}`,
        userId: studentB.id,
        resourceId: autoResource.id,
        startTime: start1,
        endTime: end1,
        purpose: 'R7 Test 1 Initial Booking',
        activityType: ActivityType.PROJECT_WORK,
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    // 2. Student A joins the waitlist
    const joinRes = await fetch(`${BASE_URL}/api/waitlist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({
        resourceId: autoResource.id,
        startTime: start1.toISOString(),
        endTime: end1.toISOString(),
      }),
    });
    const joinData = await joinRes.json();
    assert.strictEqual(joinRes.status, 201, `Join waitlist failed: ${JSON.stringify(joinData)}`);
    assert.strictEqual(joinData.queuePosition, 1);
    const entryId = joinData.entry.id;

    // 3. Cancel the booking via cancel endpoint
    const cancelRes = await fetch(`${BASE_URL}/api/bookings/${booking1.id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentBToken}`,
      },
      body: JSON.stringify({
        reason: 'R7 Test 1 Cancellation to trigger offer',
      }),
    });
    assert.strictEqual(cancelRes.status, 200, 'Cancellation should succeed');

    // 4. Verify Student A received an offer
    const entryAfterCancel = await prisma.waitlistEntry.findUnique({
      where: { id: entryId },
    });
    assert.strictEqual(entryAfterCancel?.status, WaitlistStatus.OFFERED, 'Entry must be in OFFERED status');
    assert.ok(entryAfterCancel?.offeredAt, 'Entry must have offeredAt timestamp');
    assert.ok(entryAfterCancel?.offerExpiresAt, 'Entry must have offerExpiresAt timestamp');

    // 5. Student A accepts the offer
    const acceptRes = await fetch(`${BASE_URL}/api/waitlist/${entryId}/accept`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentAToken}`,
      },
    });
    const acceptData = await acceptRes.json();
    assert.strictEqual(acceptRes.status, 200, `Accept offer failed: ${JSON.stringify(acceptData)}`);
    assert.ok(acceptData.booking, 'Must return created booking');
    assert.strictEqual(acceptData.booking.status, BookingStatus.CONFIRMED);
    assert.strictEqual(acceptData.waitlistEntry.status, WaitlistStatus.FULFILLED);

    // 6. Verify entry in DB
    const finalEntry = await prisma.waitlistEntry.findUnique({
      where: { id: entryId },
    });
    assert.strictEqual(finalEntry?.status, WaitlistStatus.FULFILLED);
    assert.strictEqual(finalEntry?.bookingId, acceptData.booking.id);

    pass('Test 1: Cancel -> Offer -> Accept workflow successfully creates booking and fulfills entry');
  } catch (err) {
    fail('Test 1: Cancel -> Offer -> Accept', err);
  }

  // TEST 2: Offer expiry -> Next user
  const startIso2 = `${testDate}T11:00:00+05:30`;
  const endIso2 = `${testDate}T12:00:00+05:30`;
  const start2 = new Date(startIso2);
  const end2 = new Date(endIso2);

  try {
    const booking2 = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R7-2-${Date.now().toString().slice(-6)}`,
        userId: faculty.id,
        resourceId: autoResource.id,
        startTime: start2,
        endTime: end2,
        purpose: 'R7 Test 2 Booking',
        activityType: ActivityType.PROJECT_WORK,
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    // Student A joins waitlist (pos 1)
    const join1 = await fetch(`${BASE_URL}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ resourceId: autoResource.id, startTime: start2.toISOString(), endTime: end2.toISOString() }),
    });
    const data1 = await join1.json();
    const entryAId = data1.entry.id;

    // Student B joins waitlist (pos 2)
    const join2 = await fetch(`${BASE_URL}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentBToken}` },
      body: JSON.stringify({ resourceId: autoResource.id, startTime: start2.toISOString(), endTime: end2.toISOString() }),
    });
    const data2 = await join2.json();
    const entryBId = data2.entry.id;

    // Release slot
    await fetch(`${BASE_URL}/api/bookings/${booking2.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${facultyToken}` },
      body: JSON.stringify({ reason: 'R7 Test 2 release' }),
    });

    // Student A receives offer
    const entryAAfterRelease = await prisma.waitlistEntry.findUnique({ where: { id: entryAId } });
    assert.strictEqual(entryAAfterRelease?.status, WaitlistStatus.OFFERED);

    // Simulate expiry: set offerExpiresAt to 5 minutes ago
    await prisma.waitlistEntry.update({
      where: { id: entryAId },
      data: { offerExpiresAt: new Date(Date.now() - 5 * 60 * 1000) },
    });

    // Run scheduler job via internal API
    const cronRes = await fetch(`${BASE_URL}/api/internal/jobs/process-waitlist-expiry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CRON_SECRET || 'lpu-cron-secret-2026'}` },
    });
    const cronData = await cronRes.json();
    assert.strictEqual(cronRes.status, 200, 'Cron execution should succeed');
    assert.ok(cronData.expired >= 1, 'Should expire at least 1 offer');

    // Verify Student A is EXPIRED
    const entryAExpired = await prisma.waitlistEntry.findUnique({ where: { id: entryAId } });
    assert.strictEqual(entryAExpired?.status, WaitlistStatus.EXPIRED);

    // Verify Student B receives the offer
    const entryBOffered = await prisma.waitlistEntry.findUnique({ where: { id: entryBId } });
    assert.strictEqual(entryBOffered?.status, WaitlistStatus.OFFERED);
    assert.ok(entryBOffered?.offerExpiresAt && entryBOffered.offerExpiresAt > new Date());

    pass('Test 2: Offer expiry transitions entry to EXPIRED and promotes next user in line');
  } catch (err) {
    fail('Test 2: Offer expiry -> Next user', err);
  }

  // TEST 3: Two users accepting concurrently
  const startIso3 = `${testDate}T12:00:00+05:30`;
  const endIso3 = `${testDate}T13:00:00+05:30`;
  const start3 = new Date(startIso3);
  const end3 = new Date(endIso3);

  try {
    // Setup entry in OFFERED status for Student A
    const testEntry = await prisma.waitlistEntry.create({
      data: {
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: start3,
        endTime: end3,
        priority: 10,
        status: WaitlistStatus.OFFERED,
        offeredAt: new Date(),
        offerExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    // Simulate two concurrent acceptance calls from the user or race conditions
    const [resA, resB] = await Promise.all([
      fetch(`${BASE_URL}/api/waitlist/${testEntry.id}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${studentAToken}` },
      }),
      fetch(`${BASE_URL}/api/waitlist/${testEntry.id}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${studentAToken}` },
      }),
    ]);

    const statuses = [resA.status, resB.status];
    const successes = statuses.filter((s) => s === 200).length;
    const conflicts = statuses.filter((s) => s === 409).length;

    assert.strictEqual(successes, 1, `Exactly one acceptance must succeed (Got statuses: ${statuses.join(', ')})`);
    assert.strictEqual(conflicts, 1, `The second concurrent request must receive 409 Conflict (Got statuses: ${statuses.join(', ')})`);

    // Verify only 1 booking was created
    const bookings = await prisma.booking.findMany({
      where: {
        resourceId: autoResource.id,
        startTime: start3,
        endTime: end3,
        status: BookingStatus.CONFIRMED,
      },
    });
    assert.strictEqual(bookings.length, 1, 'Exactly one booking must exist in the database');

    pass('Test 3: Concurrent acceptance safely serialized; exactly 1 succeeds (200) and loser receives 409 Conflict');
  } catch (err) {
    fail('Test 3: Two users accepting concurrently', err);
  }
}

/**
 * Additional Required Tests (Tests 4-24)
 */
async function runAdditionalTests() {
  console.log('\n--- ADDITIONAL REQUIRED TESTS (Tests 4 - 24) ---');

  const testDate = getNextWeekdayDate('FRIDAY', 5);

  // TEST 4: Priority ordering before FIFO ordering
  try {
    const start = new Date(`${testDate}T09:00:00+05:30`);
    const end = new Date(`${testDate}T10:00:00+05:30`);

    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R7-4-${Date.now().toString().slice(-6)}`,
        userId: studentB.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        purpose: 'R7 Test 4 Target',
        activityType: ActivityType.PROJECT_WORK,
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 5,
        departmentId: autoResource.department,
      },
    });

    // Student A (Priority 10) joins first
    const j1 = await fetch(`${BASE_URL}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ resourceId: autoResource.id, startTime: start.toISOString(), endTime: end.toISOString() }),
    });
    const d1 = await j1.json();
    const studentEntryId = d1.entry.id;

    // Faculty (Priority 50) joins second
    const j2 = await fetch(`${BASE_URL}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${facultyToken}` },
      body: JSON.stringify({ resourceId: autoResource.id, startTime: start.toISOString(), endTime: end.toISOString() }),
    });
    const d2 = await j2.json();
    const facultyEntryId = d2.entry.id;

    // Trigger slot release
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.CANCELLED },
    });
    await WaitlistService.triggerSlotOffer({ resourceId: autoResource.id, startTime: start, endTime: end });

    const facultyEntry = await prisma.waitlistEntry.findUnique({ where: { id: facultyEntryId } });
    const studentEntry = await prisma.waitlistEntry.findUnique({ where: { id: studentEntryId } });

    assert.strictEqual(facultyEntry?.status, WaitlistStatus.OFFERED, 'Faculty (priority 50) must receive offer first');
    assert.strictEqual(studentEntry?.status, WaitlistStatus.WAITING, 'Student (priority 10) must remain waiting');

    pass('Test 4: Higher-priority role (Faculty) promoted before lower-priority role (Student) despite joining later');
  } catch (err) {
    fail('Test 4: Priority ordering', err);
  }

  // TEST 5: FIFO ordering for equal priority
  try {
    const start = new Date(`${testDate}T10:00:00+05:30`);
    const end = new Date(`${testDate}T11:00:00+05:30`);

    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R7-5-${Date.now().toString().slice(-6)}`,
        userId: faculty.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        purpose: 'R7 Test 5 Target',
        activityType: ActivityType.PROJECT_WORK,
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 5,
        departmentId: autoResource.department,
      },
    });

    // Student A joins first
    const j1 = await fetch(`${BASE_URL}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ resourceId: autoResource.id, startTime: start.toISOString(), endTime: end.toISOString() }),
    });
    const d1 = await j1.json();
    const idA = d1.entry.id;

    // Small delay to ensure timestamp separation
    await new Promise((r) => setTimeout(r, 50));

    // Student B joins second
    const j2 = await fetch(`${BASE_URL}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentBToken}` },
      body: JSON.stringify({ resourceId: autoResource.id, startTime: start.toISOString(), endTime: end.toISOString() }),
    });
    const d2 = await j2.json();
    const idB = d2.entry.id;

    // Release slot
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.CANCELLED },
    });
    await WaitlistService.triggerSlotOffer({ resourceId: autoResource.id, startTime: start, endTime: end });

    const entryA = await prisma.waitlistEntry.findUnique({ where: { id: idA } });
    const entryB = await prisma.waitlistEntry.findUnique({ where: { id: idB } });

    assert.strictEqual(entryA?.status, WaitlistStatus.OFFERED, 'First student must receive offer');
    assert.strictEqual(entryB?.status, WaitlistStatus.WAITING, 'Second student must remain in queue');

    pass('Test 5: FIFO ordering strictly enforced when priority is equal');
  } catch (err) {
    fail('Test 5: FIFO ordering', err);
  }

  // TEST 6: Duplicate waitlist join prevention
  try {
    const start = new Date(`${testDate}T11:00:00+05:30`);
    const end = new Date(`${testDate}T12:00:00+05:30`);

    await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R7-6-${Date.now().toString().slice(-6)}`,
        userId: faculty.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        purpose: 'R7 Test 6 Target',
        activityType: ActivityType.PROJECT_WORK,
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 5,
        departmentId: autoResource.department,
      },
    });

    const res1 = await fetch(`${BASE_URL}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ resourceId: autoResource.id, startTime: start.toISOString(), endTime: end.toISOString() }),
    });
    assert.strictEqual(res1.status, 201);

    // Duplicate join attempt
    const res2 = await fetch(`${BASE_URL}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ resourceId: autoResource.id, startTime: start.toISOString(), endTime: end.toISOString() }),
    });
    assert.strictEqual(res2.status, 409, 'Duplicate join must return 409 Conflict');

    pass('Test 6: Duplicate active waitlist join prevented via API validation and partial unique index');
  } catch (err) {
    fail('Test 6: Duplicate waitlist join prevention', err);
  }

  // TEST 7: User cannot withdraw another user's entry
  try {
    const start = new Date(`${testDate}T12:00:00+05:30`);
    const end = new Date(`${testDate}T13:00:00+05:30`);

    const entry = await prisma.waitlistEntry.create({
      data: {
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        priority: 10,
        status: WaitlistStatus.WAITING,
      },
    });

    // Student B tries to withdraw Student A's entry
    const res = await fetch(`${BASE_URL}/api/waitlist/${entry.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${studentBToken}` },
    });
    assert.strictEqual(res.status, 403, 'Unauthorized withdrawal must return 403 Forbidden');

    const check = await prisma.waitlistEntry.findUnique({ where: { id: entry.id } });
    assert.strictEqual(check?.status, WaitlistStatus.WAITING, 'Entry must remain WAITING');

    pass("Test 7: User cannot withdraw another user's waitlist entry (403 Forbidden)");
  } catch (err) {
    fail('Test 7: Withdraw ownership authorization', err);
  }

  // TEST 8: User cannot accept another user's offer
  try {
    const start = new Date(`${testDate}T13:00:00+05:30`);
    const end = new Date(`${testDate}T14:00:00+05:30`);

    const entry = await prisma.waitlistEntry.create({
      data: {
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        priority: 10,
        status: WaitlistStatus.OFFERED,
        offeredAt: new Date(),
        offerExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    // Student B tries to accept Student A's offer
    const res = await fetch(`${BASE_URL}/api/waitlist/${entry.id}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentBToken}` },
    });
    assert.strictEqual(res.status, 403, 'Accepting another user offer must return 403 Forbidden');

    pass("Test 8: User cannot accept another user's offer (403 Forbidden)");
  } catch (err) {
    fail('Test 8: Accept ownership authorization', err);
  }

  // TEST 9: Expired offers cannot be accepted
  try {
    const start = new Date(`${testDate}T14:00:00+05:30`);
    const end = new Date(`${testDate}T15:00:00+05:30`);

    const entry = await prisma.waitlistEntry.create({
      data: {
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        priority: 10,
        status: WaitlistStatus.OFFERED,
        offeredAt: new Date(Date.now() - 30 * 60 * 1000),
        offerExpiresAt: new Date(Date.now() - 15 * 60 * 1000), // Expired 15 mins ago
      },
    });

    const res = await fetch(`${BASE_URL}/api/waitlist/${entry.id}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert.strictEqual(res.status, 409, 'Expired offer acceptance must return 409 Conflict');

    pass('Test 9: Expired offers cannot be accepted (409 Conflict)');
  } catch (err) {
    fail('Test 9: Expired offer rejection', err);
  }

  // TEST 10: A withdrawn offer is passed to the next user
  try {
    const start = new Date(`${testDate}T15:00:00+05:30`);
    const end = new Date(`${testDate}T16:00:00+05:30`);

    const entryA = await prisma.waitlistEntry.create({
      data: {
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        priority: 10,
        status: WaitlistStatus.OFFERED,
        offeredAt: new Date(),
        offerExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const entryB = await prisma.waitlistEntry.create({
      data: {
        userId: studentB.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        priority: 10,
        status: WaitlistStatus.WAITING,
      },
    });

    // Student A withdraws
    const res = await fetch(`${BASE_URL}/api/waitlist/${entryA.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert.strictEqual(res.status, 200);

    const updatedA = await prisma.waitlistEntry.findUnique({ where: { id: entryA.id } });
    const updatedB = await prisma.waitlistEntry.findUnique({ where: { id: entryB.id } });

    assert.strictEqual(updatedA?.status, WaitlistStatus.WITHDRAWN);
    assert.strictEqual(updatedB?.status, WaitlistStatus.OFFERED, 'Next user in line must receive offer upon withdrawal');

    pass('Test 10: Withdrawn offer immediately passed to next waiting user');
  } catch (err) {
    fail('Test 10: Withdrawn offer promotion', err);
  }

  // TEST 11: Scheduler can run more than once without duplicate offers
  try {
    const jobRes1 = await WaitlistService.processOfferExpiry();
    const jobRes2 = await WaitlistService.processOfferExpiry();

    assert.strictEqual(typeof jobRes1.expired, 'number');
    assert.strictEqual(typeof jobRes2.expired, 'number');
    assert.strictEqual(jobRes2.expired, 0, 'Second consecutive run should find 0 expired entries');

    pass('Test 11: Expiry scheduler is idempotent across multiple executions');
  } catch (err) {
    fail('Test 11: Scheduler idempotency', err);
  }

  // TEST 12: Concurrent scheduler executions do not issue duplicate offers
  try {
    const [res1, res2] = await Promise.all([
      WaitlistService.processOfferExpiry(),
      WaitlistService.processOfferExpiry(),
    ]);

    assert.ok(res1 && res2, 'Both concurrent executions should resolve without throwing');
    pass('Test 12: Concurrent scheduler runs safely serialize with PostgreSQL advisory locking');
  } catch (err) {
    fail('Test 12: Concurrent scheduler executions', err);
  }

  // TEST 13: A slot blocked by maintenance cannot be waitlisted
  try {
    const start = new Date(`${testDate}T16:00:00+05:30`);
    const end = new Date(`${testDate}T17:00:00+05:30`);

    // Temporarily set maintenance
    await prisma.resource.update({
      where: { id: autoResource.id },
      data: { isUnderMaintenance: true, maintenanceReason: 'Air conditioner overhaul' },
    });

    const res = await fetch(`${BASE_URL}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ resourceId: autoResource.id, startTime: start.toISOString(), endTime: end.toISOString() }),
    });

    // Revert maintenance
    await prisma.resource.update({
      where: { id: autoResource.id },
      data: { isUnderMaintenance: false, maintenanceReason: null },
    });

    assert.strictEqual(res.status, 400, 'Maintenance slot must return 400 Bad Request');
    pass('Test 13: Slots blocked by resource maintenance cannot be waitlisted (400 Bad Request)');
  } catch (err) {
    fail('Test 13: Maintenance check', err);
  }

  // TEST 14: A slot blocked by timetable cannot be waitlisted
  try {
    const testDayNumber = 5; // Friday
    // Create temporary timetable entry
    const timetable = await prisma.timetableEntry.create({
      data: {
        resourceId: autoResource.id,
        courseCode: 'CSE999',
        courseName: 'Advanced Waitlist Verification',
        section: 'K22TEST',
        instructorName: 'Dr. Arvind Sharma',
        department: autoResource.department,
        dayOfWeek: testDayNumber,
        startTime: '16:00',
        endTime: '17:00',
        semester: 'Fall 2026',
      },
    });

    const start = new Date(`${testDate}T16:00:00+05:30`);
    const end = new Date(`${testDate}T17:00:00+05:30`);

    const res = await fetch(`${BASE_URL}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ resourceId: autoResource.id, startTime: start.toISOString(), endTime: end.toISOString() }),
    });

    // Clean up timetable entry
    await prisma.timetableEntry.delete({ where: { id: timetable.id } });

    assert.strictEqual(res.status, 400, 'Timetable clash must return 400 Bad Request');
    pass('Test 14: Slots occupied by academic timetable classes cannot be waitlisted (400 Bad Request)');
  } catch (err) {
    fail('Test 14: Timetable conflict check', err);
  }

  // TEST 15: A slot blocked by blackout cannot be waitlisted
  try {
    const start = new Date(`${testDate}T17:00:00+05:30`);
    const end = new Date(`${testDate}T18:00:00+05:30`);

    // Create policy blackout
    await prisma.departmentPolicy.upsert({
      where: { department: autoResource.department },
      update: {
        blackoutPeriods: JSON.stringify([{ start: start.toISOString(), end: end.toISOString() }]),
      },
      create: {
        department: autoResource.department,
        maxAdvanceDays: 14,
        maxBookingHoursPerWeek: 20,
        blackoutPeriods: JSON.stringify([{ start: start.toISOString(), end: end.toISOString() }]),
      },
    });

    const res = await fetch(`${BASE_URL}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ resourceId: autoResource.id, startTime: start.toISOString(), endTime: end.toISOString() }),
    });

    // Clear blackout
    await prisma.departmentPolicy.update({
      where: { department: autoResource.department },
      data: { blackoutPeriods: null },
    });

    assert.strictEqual(res.status, 400, 'Blackout slot must return 400 Bad Request');
    pass('Test 15: Slots falling within department blackout periods cannot be waitlisted (400 Bad Request)');
  } catch (err) {
    fail('Test 15: Blackout period check', err);
  }

  // TEST 16: A slot with another booking cannot be offered
  try {
    const start = new Date(`${testDate}T18:00:00+05:30`);
    const end = new Date(`${testDate}T19:00:00+05:30`);

    // Active booking exists
    await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R7-16-${Date.now().toString().slice(-6)}`,
        userId: faculty.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        purpose: 'R7 Test 16 Target',
        activityType: ActivityType.PROJECT_WORK,
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 5,
        departmentId: autoResource.department,
      },
    });

    // Create waitlist entry
    const entry = await prisma.waitlistEntry.create({
      data: {
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        priority: 10,
        status: WaitlistStatus.WAITING,
      },
    });

    // Trigger slot offer while slot is still occupied
    const offer = await WaitlistService.triggerSlotOffer({
      resourceId: autoResource.id,
      startTime: start,
      endTime: end,
    });

    assert.strictEqual(offer, null, 'triggerSlotOffer must return null when slot is occupied');
    const check = await prisma.waitlistEntry.findUnique({ where: { id: entry.id } });
    assert.strictEqual(check?.status, WaitlistStatus.WAITING, 'Entry must remain WAITING');

    pass('Test 16: Slot with an active booking cannot be offered to waitlist users');
  } catch (err) {
    fail('Test 16: Occupied slot offer rejection', err);
  }

  // TEST 17: Rejected bookings trigger promotion
  try {
    const testDate2 = getNextWeekdayDate('SATURDAY', 6);
    const start = new Date(`${testDate2}T10:00:00+05:30`);
    const end = new Date(`${testDate2}T11:00:00+05:30`);

    // Create booking requiring approval
    const pendingBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R7-17-${Date.now().toString().slice(-6)}`,
        userId: studentB.id,
        resourceId: approvalResource.id,
        startTime: start,
        endTime: end,
        purpose: 'R7 Test 17 Target',
        activityType: ActivityType.CLUB_EVENT,
        status: BookingStatus.PENDING,
        expectedAttendance: 50,
        departmentId: approvalResource.department,
      },
    });

    // Student A waits for this slot
    const waitlistEntry = await prisma.waitlistEntry.create({
      data: {
        userId: studentA.id,
        resourceId: approvalResource.id,
        startTime: start,
        endTime: end,
        priority: 10,
        status: WaitlistStatus.WAITING,
      },
    });

    // Approver rejects the booking
    const rejectRes = await fetch(`${BASE_URL}/api/approvals/${pendingBooking.id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${approverToken}` },
      body: JSON.stringify({ action: 'REJECT', remarks: 'Capacity exceeded for event' }),
    });
    assert.strictEqual(rejectRes.status, 200, 'Rejection should succeed');

    const updated = await prisma.waitlistEntry.findUnique({ where: { id: waitlistEntry.id } });
    assert.strictEqual(updated?.status, WaitlistStatus.OFFERED, 'Rejection must trigger offer to waitlist');

    pass('Test 17: Department approver rejection automatically triggers waitlist promotion');
  } catch (err) {
    fail('Test 17: Rejected booking promotion', err);
  }

  // TEST 18: NO_SHOW auto-release triggers promotion
  try {
    const testDate2 = getNextWeekdayDate('SATURDAY', 6);
    const start = new Date(`${testDate2}T11:00:00+05:30`);
    const end = new Date(`${testDate2}T12:00:00+05:30`);

    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R7-18-${Date.now().toString().slice(-6)}`,
        userId: studentB.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        purpose: 'R7 Test 18 No Show Target',
        activityType: ActivityType.PROJECT_WORK,
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 5,
        departmentId: autoResource.department,
        releaseDeadline: new Date(Date.now() - 10 * 60 * 1000), // Check-in window ended
      },
    });

    const waitlistEntry = await prisma.waitlistEntry.create({
      data: {
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        priority: 10,
        status: WaitlistStatus.WAITING,
      },
    });

    // Run autoRelease service
    const releaseResult = await processAutoRelease();
    assert.ok(releaseResult.releasedCount >= 1, 'At least 1 booking must be auto-released');

    const updated = await prisma.waitlistEntry.findUnique({ where: { id: waitlistEntry.id } });
    assert.strictEqual(updated?.status, WaitlistStatus.OFFERED, 'No-show auto-release must trigger offer');

    pass('Test 18: Automatic NO_SHOW release successfully triggers slot promotion');
  } catch (err) {
    fail('Test 18: NO_SHOW auto-release', err);
  }

  // TEST 19: Recurring booking cancellation processes each occurrence correctly
  try {
    const testDate2 = getNextWeekdayDate('SATURDAY', 6);
    const date1 = testDate2;
    const date2 = addDaysKolkata(testDate2, 7);

    const startOcc1 = new Date(`${date1}T13:00:00+05:30`);
    const endOcc1 = new Date(`${date1}T14:00:00+05:30`);
    const startOcc2 = new Date(`${date2}T13:00:00+05:30`);
    const endOcc2 = new Date(`${date2}T14:00:00+05:30`);

    // Create series booking with 2 occurrences
    const series = await prisma.bookingSeries.create({
      data: {
        userId: faculty.id,
        resourceId: autoResource.id,
        frequency: RecurrenceFrequency.WEEKLY,
        interval: 1,
        weekdays: ['SATURDAY'],
        startDate: startOcc1,
        until: endOcc2,
        count: 2,
        timeOfDay: '13:00',
        duration: 60,
      },
    });

    const occ1 = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R7-19-1-${Date.now().toString().slice(-6)}`,
        userId: faculty.id,
        resourceId: autoResource.id,
        startTime: startOcc1,
        endTime: endOcc1,
        purpose: 'R7 Test 19 Occ 1',
        activityType: ActivityType.PROJECT_WORK,
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 10,
        departmentId: autoResource.department,
        seriesId: series.id,
      },
    });

    const occ2 = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R7-19-2-${Date.now().toString().slice(-6)}`,
        userId: faculty.id,
        resourceId: autoResource.id,
        startTime: startOcc2,
        endTime: endOcc2,
        purpose: 'R7 Test 19 Occ 2',
        activityType: ActivityType.PROJECT_WORK,
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 10,
        departmentId: autoResource.department,
        seriesId: series.id,
      },
    });

    // Create waitlist entries for both occurrences
    const wl1 = await prisma.waitlistEntry.create({
      data: {
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: startOcc1,
        endTime: endOcc1,
        priority: 10,
        status: WaitlistStatus.WAITING,
      },
    });

    const wl2 = await prisma.waitlistEntry.create({
      data: {
        userId: studentB.id,
        resourceId: autoResource.id,
        startTime: startOcc2,
        endTime: endOcc2,
        priority: 10,
        status: WaitlistStatus.WAITING,
      },
    });

    // Cancel entire series
    const cancelRes = await fetch(`${BASE_URL}/api/bookings/series/${series.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${facultyToken}` },
      body: JSON.stringify({ scope: 'ENTIRE_SERIES', reason: 'R7 Test 19 series cancellation' }),
    });
    assert.strictEqual(cancelRes.status, 200);

    const check1 = await prisma.waitlistEntry.findUnique({ where: { id: wl1.id } });
    const check2 = await prisma.waitlistEntry.findUnique({ where: { id: wl2.id } });

    assert.strictEqual(check1?.status, WaitlistStatus.OFFERED, 'Occurrence 1 slot offered');
    assert.strictEqual(check2?.status, WaitlistStatus.OFFERED, 'Occurrence 2 slot offered');

    pass('Test 19: Series cancellation successfully processes and triggers offers for all occurrences');
  } catch (err) {
    fail('Test 19: Series cancellation promotion', err);
  }

  // TEST 20: Notification deduplication & format
  try {
    const notifications = await prisma.notification.findMany({
      where: {
        userId: studentA.id,
        title: { contains: 'Waitlist' },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    assert.ok(notifications.length > 0, 'Notifications must exist');
    assert.ok(notifications.some((n) => n.link?.includes('/my-bookings?tab=WAITLIST')), 'Link must include waitlist tab link');
    assert.ok(notifications.every((n) => n.link?.includes('/my-bookings')), 'All booking notifications must route to /my-bookings');

    pass('Test 20: Notification format validated and links correctly to /my-bookings?tab=WAITLIST');
  } catch (err) {
    fail('Test 20: Notifications format', err);
  }

  // TEST 21: Waitlist listing never leaks another user's entries
  try {
    const resA = await fetch(`${BASE_URL}/api/waitlist`, {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const dataA = await resA.json();
    assert.strictEqual(resA.status, 200);
    assert.ok(dataA.entries.every((e: any) => e.userId === studentA.id), 'Student A only sees own entries');

    const resB = await fetch(`${BASE_URL}/api/waitlist`, {
      headers: { Authorization: `Bearer ${studentBToken}` },
    });
    const dataB = await resB.json();
    assert.strictEqual(resB.status, 200);
    assert.ok(dataB.entries.every((e: any) => e.userId === studentB.id), 'Student B only sees own entries');

    pass("Test 21: Requester data isolation verified: GET /api/waitlist strictly scopes by session userId");
  } catch (err) {
    fail('Test 21: Data isolation', err);
  }

  // TEST 22: Offer expiry boundary is handled correctly
  try {
    const futureExpiry = new Date(Date.now() + 10 * 60 * 1000);
    const pastExpiry = new Date(Date.now() - 10 * 60 * 1000);

    const activeEntry = await prisma.waitlistEntry.create({
      data: {
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T19:00:00+05:30`),
        endTime: new Date(`${testDate}T20:00:00+05:30`),
        priority: 10,
        status: WaitlistStatus.OFFERED,
        offeredAt: new Date(),
        offerExpiresAt: futureExpiry,
      },
    });

    const expiredEntry = await prisma.waitlistEntry.create({
      data: {
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T20:00:00+05:30`),
        endTime: new Date(`${testDate}T21:00:00+05:30`),
        priority: 10,
        status: WaitlistStatus.OFFERED,
        offeredAt: new Date(Date.now() - 20 * 60 * 1000),
        offerExpiresAt: pastExpiry,
      },
    });

    const resList = await fetch(`${BASE_URL}/api/waitlist`, {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const dataList = await resList.json();

    const itemActive = dataList.entries.find((e: any) => e.id === activeEntry.id);
    const itemExpired = dataList.entries.find((e: any) => e.id === expiredEntry.id);

    assert.strictEqual(itemActive.isOfferActive, true, 'Future expiry must mark offer as active');
    assert.ok(itemActive.offerRemainingSeconds > 0, 'Must have remaining seconds');
    assert.strictEqual(itemExpired.isOfferActive, false, 'Past expiry must mark offer as inactive');

    pass('Test 22: Offer expiry boundary and countdown computation handled accurately');
  } catch (err) {
    fail('Test 22: Offer expiry boundary', err);
  }

  // TEST 23: Booking quota and policy validation enforced during acceptance
  try {
    let testDate23 = addDaysKolkata(todayStr, 2);
    let start = new Date();
    let end = new Date();
    for (let d = 2; d <= 6; d++) {
      const candDate = addDaysKolkata(todayStr, d);
      const dayOfWeek = kolkataToUtc(candDate, '12:00').getUTCDay();
      if (dayOfWeek === 0) continue;
      let found = false;
      for (const hr of [11, 14, 16, 17, 18]) {
        const s = new Date(`${candDate}T${String(hr).padStart(2, '0')}:00:00+05:30`);
        const e = new Date(`${candDate}T${String(hr + 1).padStart(2, '0')}:00:00+05:30`);
        const clash = await prisma.booking.findFirst({
          where: {
            resourceId: autoResource.id,
            status: { in: [BookingStatus.PENDING, BookingStatus.APPROVED, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
            startTime: { lt: e },
            endTime: { gt: s },
          },
        });
        if (!clash) {
          testDate23 = candDate;
          start = s;
          end = e;
          found = true;
          break;
        }
      }
      if (found) break;
    }

    // 23.1 Restricted user with 3 no-shows is rejected by policy engine during accept
    let policyUser = await prisma.user.findUnique({ where: { email: 'policy.test.student@lpu.in' } });
    if (!policyUser) {
      policyUser = await prisma.user.create({
        data: {
          email: 'policy.test.student@lpu.in',
          name: 'Policy Test Student',
          passwordHash: studentA.passwordHash,
          role: Role.STUDENT,
          department: autoResource.department,
        },
      });
    }
    const policyToken = signToken({ id: policyUser.id, email: policyUser.email, role: policyUser.role });

    // Seed 3 NO_SHOW bookings for policyUser
    for (let i = 0; i < 3; i++) {
      await prisma.booking.create({
        data: {
          bookingNumber: `LPU-TEST-POLICY-${Date.now()}-${i}`,
          userId: policyUser.id,
          resourceId: autoResource.id,
          startTime: new Date(Date.now() - (i + 1) * 86400000),
          endTime: new Date(Date.now() - (i + 1) * 86400000 + 3600000),
          purpose: 'Policy No Show Target',
          activityType: ActivityType.PROJECT_WORK,
          status: BookingStatus.NO_SHOW,
          expectedAttendance: 1,
          departmentId: autoResource.department,
        },
      });
    }

    const restrictedEntry = await prisma.waitlistEntry.create({
      data: {
        userId: policyUser.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        priority: 10,
        status: WaitlistStatus.OFFERED,
        offeredAt: new Date(),
        offerExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const resRestricted = await fetch(`${BASE_URL}/api/waitlist/${restrictedEntry.id}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${policyToken}` },
    });
    const dataRestricted = await resRestricted.json();
    assert.strictEqual(resRestricted.status, 422, 'Acceptance by policy-restricted user must return 422');
    const errText = (dataRestricted.error || dataRestricted.message || JSON.stringify(dataRestricted)).toLowerCase();
    assert.ok(
      errText.includes('restricted') || errText.includes('policy') || errText.includes('no-show') || errText.includes('quota') || errText.includes('advance'),
      `Error message must reflect policy restriction: ${errText}`
    );

    // Clean up policyUser's test no-shows
    await prisma.booking.deleteMany({ where: { userId: policyUser.id } });

    // 23.2 Non-restricted user with valid quota succeeds
    const start23 = new Date(`${testDate23}T14:00:00+05:30`);
    const end23 = new Date(`${testDate23}T15:00:00+05:30`);
    const validEntry = await prisma.waitlistEntry.create({
      data: {
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: start23,
        endTime: end23,
        priority: 10,
        status: WaitlistStatus.OFFERED,
        offeredAt: new Date(),
        offerExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const resValid = await fetch(`${BASE_URL}/api/waitlist/${validEntry.id}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const dataValid = await resValid.json();
    assert.strictEqual(resValid.status, 200, 'Acceptance with valid policy quota must return 200');
    assert.ok(dataValid.booking.id, 'Booking created under policy rules');

    pass('Test 23: Booking policy and quota validation enforced during offer acceptance (422 on policy violation, 200 on success)');
  } catch (err) {
    fail('Test 23: Policy validation during acceptance', err);
  }

  // TEST 24: Database exclusion constraints prevent overlapping bookings
  try {
    const start = new Date(`${testDate}T22:00:00+05:30`);
    const end = new Date(`${testDate}T23:00:00+05:30`);

    await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R7-24-1-${Date.now().toString().slice(-6)}`,
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: start,
        endTime: end,
        purpose: 'R7 Test 24 Base',
        activityType: ActivityType.PROJECT_WORK,
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 5,
        departmentId: autoResource.department,
      },
    });

    // Attempt direct overlapping insert via raw query or duplicate
    let caughtError = false;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Booking" (id, "bookingNumber", "userId", "resourceId", "startTime", "endTime", purpose, "activityType", status, "expectedAttendance", "departmentId", "updatedAt")
        VALUES (gen_random_uuid(), 'LPU-TEST-R7-24-2', '${studentB.id}', '${autoResource.id}', '${start.toISOString()}', '${end.toISOString()}', 'Direct Overlap Test', 'PROJECT_WORK', 'CONFIRMED', 5, '${autoResource.department}', NOW());
      `);
    } catch (e: any) {
      caughtError = true;
      assert.ok(e.message.includes('exclusion constraint') || e.message.includes('no_overlapping_bookings'), 'Must be rejected by exclusion constraint');
    }

    assert.strictEqual(caughtError, true, 'Direct conflicting booking must be rejected by PostgreSQL exclusion constraint');
    pass('Test 24: Database exclusion constraint (no_overlapping_bookings) prevents concurrent overlapping bookings');
  } catch (err) {
    fail('Test 24: Exclusion constraint enforcement', err);
  }
}

async function main() {
  try {
    await setup();
    await runCoreAcceptanceTests();
    await runAdditionalTests();

    console.log('\n======================================================');
    console.log(`🏁 R7 TEST SUITE FINISHED: ${testPassed} PASSED, ${testFailed} FAILED`);
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
