import assert from 'assert';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { BookingStatus, ActivityType, PriorityLevel, Role, ResourceCategory } from '@prisma/client';
import env from '../src/config/env';
import {
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

function signToken(payload: { id: string; email: string; role: Role }) {
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

let createdR6UserIds: string[] = [];
let createdR6ResourceIds: string[] = [];

async function cleanup() {
  await prisma.idempotencyKey.deleteMany({
    where: { key: { startsWith: 'r6-test-' } },
  });

  await prisma.booking.deleteMany({
    where: {
      OR: [
        { bookingNumber: { startsWith: 'LPU-TEST-' } },
        { purpose: { contains: 'R6 Test' } },
        { purpose: { contains: 'Lifecycle Target' } },
        { purpose: { contains: 'State machine' } },
        { purpose: { contains: 'Concurrent test' } },
        { purpose: { contains: 'Ownership security' } },
        ...(createdR6ResourceIds.length > 0 ? [{ resourceId: { in: createdR6ResourceIds } }] : []),
        ...(createdR6UserIds.length > 0 ? [{ userId: { in: createdR6UserIds } }] : []),
      ],
    },
  });

  if (createdR6ResourceIds.length > 0) {
    await prisma.resource.deleteMany({ where: { id: { in: createdR6ResourceIds } } }).catch(() => {});
  }
  if (createdR6UserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdR6UserIds } } }).catch(() => {});
  }
}

async function setup() {
  console.log('\n======================================================');
  console.log('🚀 INITIALIZING R6 TEST SUITE: BOOKING LIFECYCLE & MY BOOKINGS');
  console.log('======================================================\n');

  const ts = Date.now();
  const pwdHash = await bcrypt.hash('Lpu@12345', 10);

  studentA = await prisma.user.create({
    data: {
      email: `r6.studentA.${ts}@lpu.in`,
      name: 'R6 Isolated Student A',
      passwordHash: pwdHash,
      role: Role.STUDENT,
      department: 'Computer Science',
      regNo: `R6A${String(ts).slice(-6)}`,
      emailVerified: true,
    },
  });
  studentB = await prisma.user.create({
    data: {
      email: `r6.studentB.${ts}@lpu.in`,
      name: 'R6 Isolated Student B',
      passwordHash: pwdHash,
      role: Role.STUDENT,
      department: 'Computer Science',
      regNo: `R6B${String(ts).slice(-6)}`,
      emailVerified: true,
    },
  });
  createdR6UserIds = [studentA.id, studentB.id];

  faculty = await prisma.user.findUnique({ where: { email: 'arvind.cse@lpu.in' } });
  approver = await prisma.user.findUnique({ where: { email: 'approver.sece@lpu.in' } });
  admin = await prisma.user.findUnique({ where: { email: 'admin.estate@lpu.in' } });

  if (!studentA || !studentB || !faculty || !approver || !admin) {
    throw new Error('Required seed users are missing. Run npm run db:seed first.');
  }

  studentAToken = signToken({ id: studentA.id, email: studentA.email, role: studentA.role });
  studentBToken = signToken({ id: studentB.id, email: studentB.email, role: studentB.role });
  facultyToken = signToken({ id: faculty.id, email: faculty.email, role: faculty.role });
  approverToken = signToken({ id: approver.id, email: approver.email, role: approver.role });
  adminToken = signToken({ id: admin.id, email: admin.email, role: admin.role });

  autoResource = await prisma.resource.create({
    data: {
      code: `R6-ROOM-${String(ts).slice(-6)}`,
      name: `R6 Isolated Classroom ${String(ts).slice(-4)}`,
      category: ResourceCategory.CLASSROOM,
      department: approver.department,
      building: 'Block 34',
      floor: '2nd Floor',
      capacity: 60,
      amenities: ['Projector', 'Wi-Fi'],
      imageUrl: 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=600&q=80',
      requiresApproval: false,
      operatingHours: '08:00 AM - 08:00 PM',
    },
  });
  approvalResource = await prisma.resource.create({
    data: {
      code: `R6-APPR-${String(ts).slice(-6)}`,
      name: `R6 Isolated Approval Hall ${String(ts).slice(-4)}`,
      category: ResourceCategory.SEMINAR_HALL,
      department: approver.department,
      building: 'Block 34',
      floor: '3rd Floor',
      capacity: 80,
      amenities: ['Projector', 'Audio System'],
      imageUrl: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=600&q=80',
      requiresApproval: true,
      operatingHours: '08:00 AM - 08:00 PM',
    },
  });
  createdR6ResourceIds = [autoResource.id, approvalResource.id];

  assert.ok(autoResource, 'Auto-confirmable resource exists');
  assert.ok(approvalResource, 'Approval-required resource exists');

  console.log(`  ✓ Isolated fixtures created: Student (${studentA.email}), Resource (${autoResource.name})`);
}

async function runRescheduleTests() {
  console.log('\n--- SUITE 1: Reschedule Booking Tests (PUT /api/bookings/[id]) ---');

  const testDate = getNextWeekdayDate('THURSDAY', 7);
  let targetBooking: any;

  try {
    targetBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-${Date.now().toString().slice(-6)}`,
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T14:00:00+05:30`),
        endTime: new Date(`${testDate}T15:00:00+05:30`),
        purpose: 'R6 Test Reschedule Target',
        activityType: ActivityType.PROJECT_WORK,
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    // 1.1 Reschedule by booking owner to a free slot on the same day
    const newStart = `${testDate}T16:00:00+05:30`;
    const newEnd = `${testDate}T17:00:00+05:30`;

    const res1 = await fetch(`${BASE_URL}/api/bookings/${targetBooking.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({
        startTime: new Date(newStart).toISOString(),
        endTime: new Date(newEnd).toISOString(),
        purpose: 'R6 Test Rescheduled Purpose',
      }),
    });

    const data1 = await res1.json();
    assert.strictEqual(res1.status, 200, `Expected 200, got ${res1.status}: ${JSON.stringify(data1)}`);
    assert.strictEqual(data1.newSchedule.status, 'CONFIRMED');
    assert.strictEqual(data1.booking.purpose, 'R6 Test Rescheduled Purpose');
    pass('1.1 Reschedule by booking owner updates times, status, and returns updated contract');

    // 1.2 Unauthorized reschedule by another requester rejected with 403
    const res2 = await fetch(`${BASE_URL}/api/bookings/${targetBooking.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentBToken}`,
      },
      body: JSON.stringify({
        startTime: new Date(newStart).toISOString(),
        endTime: new Date(newEnd).toISOString(),
      }),
    });
    assert.strictEqual(res2.status, 403, 'Unauthorized reschedule must return 403');
    pass('1.2 Unauthorized requester reschedule rejected with 403');

    // 1.3 Self-overlap exclusion: rescheduling to slightly shifted overlapping time [16:30, 17:30)
    // The current booking is at [16:00, 17:00). Exclude itself so it does not conflict with its own interval!
    const shiftStart = `${testDate}T16:30:00+05:30`;
    const shiftEnd = `${testDate}T17:30:00+05:30`;

    const res3 = await fetch(`${BASE_URL}/api/bookings/${targetBooking.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({
        startTime: new Date(shiftStart).toISOString(),
        endTime: new Date(shiftEnd).toISOString(),
      }),
    });
    const data3 = await res3.json();
    assert.strictEqual(res3.status, 200, `Self-overlap should succeed, got ${res3.status}: ${JSON.stringify(data3)}`);
    pass('1.3 Rescheduling excludes the booking itself from conflict checks');

    // 1.4 Conflict with another booking returns 409 and alternative slots
    await prisma.booking.deleteMany({
      where: {
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T10:00:00+05:30`),
      },
    });

    const conflictBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-CLASH-${Date.now().toString().slice(-5)}`,
        userId: faculty.id,
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T10:00:00+05:30`),
        endTime: new Date(`${testDate}T11:00:00+05:30`),
        purpose: 'R6 Test Blocking Slot',
        activityType: ActivityType.CLASS_LECTURE,
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 20,
      },
    });

    const res4 = await fetch(`${BASE_URL}/api/bookings/${targetBooking.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({
        startTime: new Date(`${testDate}T10:00:00+05:30`).toISOString(),
        endTime: new Date(`${testDate}T11:00:00+05:30`).toISOString(),
      }),
    });
    const data4 = await res4.json();
    assert.strictEqual(res4.status, 409, 'Conflict must return 409');
    assert.ok(data4.details?.alternativeSlots?.length > 0, `Must include alternative slots, got: ${JSON.stringify(data4)}`);
    await prisma.booking.delete({ where: { id: conflictBooking.id } });
    pass('1.4 Conflicting reschedule returns 409 with alternative slots and preserves original booking');

    // 1.5 Reschedule to approval-required resource moves status to PENDING
    const res5 = await fetch(`${BASE_URL}/api/bookings/${targetBooking.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({
        resourceId: approvalResource.id,
        startTime: new Date(`${testDate}T16:00:00+05:30`).toISOString(),
        endTime: new Date(`${testDate}T17:00:00+05:30`).toISOString(),
      }),
    });
    const data5 = await res5.json();
    assert.strictEqual(res5.status, 200);
    assert.strictEqual(data5.newSchedule.status, 'PENDING');
    assert.strictEqual(data5.requiresApproval, true);
    pass('1.5 Rescheduling to approval-required resource moves status to PENDING');

    // 1.6 Invalid status rejection: cannot reschedule COMPLETED or CANCELLED booking
    await prisma.booking.update({
      where: { id: targetBooking.id },
      data: { status: BookingStatus.COMPLETED },
    });

    const res6 = await fetch(`${BASE_URL}/api/bookings/${targetBooking.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({
        startTime: new Date(`${testDate}T14:00:00+05:30`).toISOString(),
        endTime: new Date(`${testDate}T15:00:00+05:30`).toISOString(),
      }),
    });
    assert.strictEqual(res6.status, 409, 'Cannot reschedule completed booking (409)');
    pass('1.6 Rescheduling COMPLETED booking rejected with 409 Conflict');
  } catch (err) {
    fail('Reschedule booking tests', err);
  } finally {
    if (targetBooking?.id) {
      await prisma.booking.delete({ where: { id: targetBooking.id } }).catch(() => {});
    }
  }
}

async function runCancellationTests() {
  console.log('\n--- SUITE 2: Cancellation Tests & Cutoff Enforcement (POST /api/bookings/[id]/cancel) ---');

  const testDate = getNextWeekdayDate('FRIDAY', 2);
  let normalBooking: any;
  let nearBooking: any;
  let checkedInBooking: any;

  try {
    // 2.1 Owner cancellation before cutoff succeeds with mandatory reason
    normalBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-CNC1-${Date.now().toString().slice(-5)}`,
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T15:00:00+05:30`),
        endTime: new Date(`${testDate}T16:00:00+05:30`),
        purpose: 'R6 Test Normal Cancellation Target',
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    const res1 = await fetch(`${BASE_URL}/api/bookings/${normalBooking.id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({ reason: 'Team meeting relocated to online platform' }),
    });

    const data1 = await res1.json();
    assert.strictEqual(res1.status, 200, `Expected 200, got ${res1.status}: ${JSON.stringify(data1)}`);
    assert.strictEqual(data1.booking.status, 'CANCELLED');
    assert.strictEqual(data1.cancellationReason, 'Team meeting relocated to online platform');
    pass('2.1 Owner cancellation before cutoff succeeds with reason');

    // 2.2 Missing or whitespace-only reason rejected with 400
    const blankBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-BLANK-${Date.now().toString().slice(-5)}`,
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T16:00:00+05:30`),
        endTime: new Date(`${testDate}T17:00:00+05:30`),
        purpose: 'R6 Test Blank Reason Target',
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    const res2 = await fetch(`${BASE_URL}/api/bookings/${blankBooking.id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({ reason: '    ' }),
    });
    assert.strictEqual(res2.status, 400, 'Whitespace reason must be rejected with 400');
    pass('2.2 Whitespace-only cancellation reason rejected with 400');
    await prisma.booking.delete({ where: { id: blankBooking.id } });

    // 2.3 Cancellation Cutoff: Requester cannot cancel booking starting in less than cutoff (60m)
    // Create booking starting in 15 minutes
    const now = new Date();
    nearBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-NEAR-${Date.now().toString().slice(-5)}`,
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(now.getTime() + 15 * 60 * 1000), // starts in 15m
        endTime: new Date(now.getTime() + 75 * 60 * 1000),
        purpose: 'R6 Test Near Cutoff Booking',
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    // Student A tries to cancel past the 60m cutoff window
    const res3 = await fetch(`${BASE_URL}/api/bookings/${nearBooking.id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({ reason: 'Emergency cancellation attempt' }),
    });
    assert.strictEqual(res3.status, 403, 'Requester past cutoff must be rejected with 403');
    pass('2.3 Requester cancellation after cutoff rejected with 403 Forbidden');

    // 2.4 Authorized Department Approver CAN cancel after cutoff
    const res4 = await fetch(`${BASE_URL}/api/bookings/${nearBooking.id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${approverToken}`,
      },
      body: JSON.stringify({ reason: 'Cancelled by Department Approver due to emergency lab setup' }),
    });
    const data4 = await res4.json();
    assert.strictEqual(res4.status, 200, `Approver should be allowed to cancel past cutoff, got ${res4.status}`);
    assert.strictEqual(data4.booking.status, 'CANCELLED');
    pass('2.4 Department Approver cancellation after cutoff succeeds (200)');

    // 2.5 State Machine Enforcement: CHECKED_IN and COMPLETED cannot be cancelled (409)
    checkedInBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-CHKD-${Date.now().toString().slice(-5)}`,
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T17:00:00+05:30`),
        endTime: new Date(`${testDate}T18:00:00+05:30`),
        purpose: 'R6 Test Checked-in Non-Cancellable',
        status: BookingStatus.CHECKED_IN,
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    const res5 = await fetch(`${BASE_URL}/api/bookings/${checkedInBooking.id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({ reason: 'Cancel checked in' }),
    });
    assert.strictEqual(res5.status, 409, 'Cancelling CHECKED_IN booking must return 409');
    pass('2.5 Cancelling CHECKED_IN booking rejected with 409 Conflict');

    // COMPLETED booking cannot be cancelled
    await prisma.booking.update({
      where: { id: checkedInBooking.id },
      data: { status: BookingStatus.COMPLETED },
    });
    const res6 = await fetch(`${BASE_URL}/api/bookings/${checkedInBooking.id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({ reason: 'Cancel completed' }),
    });
    assert.strictEqual(res6.status, 409, 'Cancelling COMPLETED booking must return 409');
    pass('2.6 Cancelling COMPLETED booking rejected with 409 Conflict');
  } catch (err) {
    fail('Cancellation tests', err);
  } finally {
    if (normalBooking?.id) await prisma.booking.delete({ where: { id: normalBooking.id } }).catch(() => {});
    if (nearBooking?.id) await prisma.booking.delete({ where: { id: nearBooking.id } }).catch(() => {});
    if (checkedInBooking?.id) await prisma.booking.delete({ where: { id: checkedInBooking.id } }).catch(() => {});
  }
}

async function runEndEarlyTests() {
  console.log('\n--- SUITE 3: End Booking Early Tests (POST /api/bookings/[id]/end-early) ---');

  const testDate = getNextWeekdayDate('MONDAY', 7);
  let liveBooking: any;

  try {
    // 3.1 Valid checked-in booking ended early
    liveBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-EARLY-${Date.now().toString().slice(-5)}`,
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T14:00:00+05:30`),
        endTime: new Date(`${testDate}T16:00:00+05:30`),
        purpose: 'R6 Test Early End Target',
        status: BookingStatus.CHECKED_IN,
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    const res1 = await fetch(`${BASE_URL}/api/bookings/${liveBooking.id}/end-early`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
    });

    const data1 = await res1.json();
    assert.strictEqual(res1.status, 200, `Expected 200, got ${res1.status}: ${JSON.stringify(data1)}`);
    assert.strictEqual(data1.booking.status, 'COMPLETED');
    assert.ok(data1.actualEndTime, 'Must record actualEndTime');
    assert.strictEqual(data1.booking.endTime, new Date(`${testDate}T16:00:00+05:30`).toISOString(), 'Original scheduled endTime must be preserved');
    pass('3.1 Valid CHECKED_IN booking completed early, preserves scheduled endTime, records actualEndTime');

    // 3.2 Non-checked-in booking end-early rejected with 409
    const pendingBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-PND-${Date.now().toString().slice(-5)}`,
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T17:00:00+05:30`),
        endTime: new Date(`${testDate}T18:00:00+05:30`),
        purpose: 'R6 Test Pending Early Target',
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    const res2 = await fetch(`${BASE_URL}/api/bookings/${pendingBooking.id}/end-early`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
    });
    assert.strictEqual(res2.status, 409, 'Non-checked-in booking end-early must return 409');
    pass('3.2 Non-checked-in booking end-early rejected with 409 Conflict');

    // 3.3 Unauthorized requester end-early rejected with 403
    await prisma.booking.update({
      where: { id: pendingBooking.id },
      data: { status: BookingStatus.CHECKED_IN },
    });

    const res3 = await fetch(`${BASE_URL}/api/bookings/${pendingBooking.id}/end-early`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentBToken}`,
      },
    });
    assert.strictEqual(res3.status, 403, 'Unauthorized requester must return 403');
    pass('3.3 Unauthorized requester end-early rejected with 403');

    await prisma.booking.delete({ where: { id: pendingBooking.id } });
  } catch (err) {
    fail('End early tests', err);
  } finally {
    if (liveBooking?.id) await prisma.booking.delete({ where: { id: liveBooking.id } }).catch(() => {});
  }
}

async function runExtensionTests() {
  console.log('\n--- SUITE 4: Booking Extension Tests (POST /api/bookings/[id]/extend) ---');

  const testDate = getNextWeekdayDate('TUESDAY', 2);
  let checkedInBooking: any;

  try {
    // 4.1 Valid extension when next slot is free
    checkedInBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-EXT-${Date.now().toString().slice(-5)}`,
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T14:00:00+05:30`),
        endTime: new Date(`${testDate}T15:00:00+05:30`),
        purpose: 'R6 Test Extension Target',
        status: BookingStatus.CHECKED_IN,
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    const res1 = await fetch(`${BASE_URL}/api/bookings/${checkedInBooking.id}/extend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({ durationMinutes: 30 }),
    });

    const data1 = await res1.json();
    assert.strictEqual(res1.status, 200, `Expected 200, got ${res1.status}: ${JSON.stringify(data1)}`);
    assert.strictEqual(data1.extendedMinutes, 30);
    assert.strictEqual(data1.newEndTime, new Date(`${testDate}T15:30:00+05:30`).toISOString());
    pass('4.1 Valid 30-minute extension succeeds when slot is free');

    // 4.2 Extension when next slot is occupied rejected with 409
    const blockerBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-BLCK-${Date.now().toString().slice(-5)}`,
        userId: faculty.id,
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T15:30:00+05:30`),
        endTime: new Date(`${testDate}T16:30:00+05:30`),
        purpose: 'R6 Test Extension Blocker',
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 15,
        departmentId: autoResource.department,
      },
    });

    const res2 = await fetch(`${BASE_URL}/api/bookings/${checkedInBooking.id}/extend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({ durationMinutes: 30 }),
    });
    assert.strictEqual(res2.status, 409, 'Extension colliding with next booking must return 409');
    pass('4.2 Extension rejected with 409 Conflict when next slot is occupied');
    await prisma.booking.delete({ where: { id: blockerBooking.id } });

    // 4.3 Non-checked-in booking cannot be extended (409)
    await prisma.booking.update({
      where: { id: checkedInBooking.id },
      data: { status: BookingStatus.CONFIRMED },
    });

    const res3 = await fetch(`${BASE_URL}/api/bookings/${checkedInBooking.id}/extend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentAToken}`,
      },
      body: JSON.stringify({ durationMinutes: 30 }),
    });
    assert.strictEqual(res3.status, 409, 'Non-checked-in booking cannot be extended');
    pass('4.3 Ineligible booking status extension rejected with 409 Conflict');
  } catch (err) {
    fail('Booking extension tests', err);
  } finally {
    if (checkedInBooking?.id) await prisma.booking.delete({ where: { id: checkedInBooking.id } }).catch(() => {});
  }
}

async function runAutoCompletionTests() {
  console.log('\n--- SUITE 5: Automatic Completion Scheduled Job Tests ---');

  let expiredBooking: any;
  let futureBooking: any;

  try {
    const now = new Date();

    // Create an expired CHECKED_IN booking (ended 15 minutes ago)
    expiredBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-EXP-${Date.now().toString().slice(-5)}`,
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(now.getTime() - 75 * 60 * 1000),
        endTime: new Date(now.getTime() - 15 * 60 * 1000), // in the past
        purpose: 'R6 Test Expired Active Target',
        status: BookingStatus.CHECKED_IN,
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    // Create a future CHECKED_IN booking (started 5 minutes ago, ends in 55 minutes)
    futureBooking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-FUT-${Date.now().toString().slice(-5)}`,
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(now.getTime() - 5 * 60 * 1000), // strictly after expiredBooking.endTime
        endTime: new Date(now.getTime() + 55 * 60 * 1000), // in future
        purpose: 'R6 Test Future Active Target',
        status: BookingStatus.CHECKED_IN,
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    // 5.1 Unauthorized job execution rejected with 401
    const res1 = await fetch(`${BASE_URL}/api/internal/jobs/complete-expired-bookings`, {
      method: 'POST',
      headers: { Authorization: 'Bearer bad-secret-token' },
    });
    assert.strictEqual(res1.status, 401, 'Invalid secret must return 401');
    pass('5.1 Unauthorized job request without valid CRON_SECRET rejected with 401');

    // 5.2 Authorized execution processes expired booking and skips future booking
    const res2 = await fetch(`${BASE_URL}/api/internal/jobs/complete-expired-bookings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
    const data2 = await res2.json();
    assert.strictEqual(res2.status, 200, `Expected 200, got ${res2.status}: ${JSON.stringify(data2)}`);
    assert.ok(data2.completed >= 1, 'At least 1 booking completed');

    // Verify database status of both bookings
    const checkExpired = await prisma.booking.findUnique({ where: { id: expiredBooking.id } });
    const checkFuture = await prisma.booking.findUnique({ where: { id: futureBooking.id } });

    assert.strictEqual(checkExpired?.status, 'COMPLETED', 'Expired booking must be transitioned to COMPLETED');
    assert.ok(checkExpired?.actualEndTime, 'actualEndTime must be recorded');
    assert.strictEqual(checkFuture?.status, 'CHECKED_IN', 'Future booking must remain CHECKED_IN');
    pass('5.2 Automatic completion job transitions expired booking to COMPLETED while preserving future booking');
  } catch (err) {
    fail('Auto completion job tests', err);
  } finally {
    if (expiredBooking?.id) await prisma.booking.delete({ where: { id: expiredBooking.id } }).catch(() => {});
    if (futureBooking?.id) await prisma.booking.delete({ where: { id: futureBooking.id } }).catch(() => {});
  }
}

async function runMyBookingsApiTests() {
  console.log('\n--- SUITE 6: My Bookings API Integration (GET /api/bookings/my) ---');

  const testDate = getNextWeekdayDate('WEDNESDAY', 2);
  let upcomingB: any;
  let pendingB: any;
  let completedB: any;

  try {
    // Create one of each status for studentA
    upcomingB = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-UPC-${Date.now().toString().slice(-5)}`,
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T10:00:00+05:30`),
        endTime: new Date(`${testDate}T11:00:00+05:30`),
        purpose: 'R6 Test Upcoming Session',
        status: BookingStatus.CONFIRMED,
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    pendingB = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-PND2-${Date.now().toString().slice(-5)}`,
        userId: studentA.id,
        resourceId: approvalResource.id,
        startTime: new Date(`${testDate}T12:00:00+05:30`),
        endTime: new Date(`${testDate}T13:00:00+05:30`),
        purpose: 'R6 Test Pending Approval',
        status: BookingStatus.PENDING,
        expectedAttendance: 10,
        departmentId: approvalResource.department,
      },
    });

    completedB = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-TEST-R6-CMP-${Date.now().toString().slice(-5)}`,
        userId: studentA.id,
        resourceId: autoResource.id,
        startTime: new Date(`${testDate}T08:00:00+05:30`),
        endTime: new Date(`${testDate}T09:00:00+05:30`),
        purpose: 'R6 Test Completed Session',
        status: BookingStatus.COMPLETED,
        actualEndTime: new Date(`${testDate}T09:00:00+05:30`),
        expectedAttendance: 10,
        departmentId: autoResource.department,
      },
    });

    // 6.1 Authenticated access returns 200 with tab counts and pagination
    const res1 = await fetch(`${BASE_URL}/api/bookings/my?tab=UPCOMING`, {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const data1 = await res1.json();
    assert.strictEqual(res1.status, 200);
    assert.ok(data1.tabCounts, 'Must include tab counts');
    assert.ok(data1.pagination, 'Must include pagination metadata');
    assert.ok(data1.bookings.some((b: any) => b.id === upcomingB.id), 'Upcoming tab must include upcoming booking');
    pass('6.1 Authenticated requester receives tab counts and upcoming bookings');

    // 6.2 Data isolation: Student B does not see Student A's upcoming booking
    const res2 = await fetch(`${BASE_URL}/api/bookings/my?tab=UPCOMING`, {
      headers: { Authorization: `Bearer ${studentBToken}` },
    });
    const data2 = await res2.json();
    assert.strictEqual(res2.status, 200);
    const foundOther = data2.bookings.some((b: any) => b.id === upcomingB.id);
    assert.strictEqual(foundOther, false, 'Student B must not see Student A booking');
    pass('6.2 Requester data isolation strictly enforced');

    // 6.3 Pending tab filtering
    const res3 = await fetch(`${BASE_URL}/api/bookings/my?tab=PENDING`, {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const data3 = await res3.json();
    assert.strictEqual(res3.status, 200);
    assert.ok(data3.bookings.some((b: any) => b.id === pendingB.id), 'Pending tab must include pending booking');
    pass('6.3 Tab filtering correctly returns PENDING bookings');

    // 6.4 Server-side action eligibility
    const fetchedUpcoming = data1.bookings.find((b: any) => b.id === upcomingB.id);
    assert.strictEqual(fetchedUpcoming.eligibility.canReschedule, true);
    assert.strictEqual(fetchedUpcoming.eligibility.canCancel, true);
    assert.strictEqual(fetchedUpcoming.eligibility.canExtend, false); // not checked in
    pass('6.4 Action eligibility computed accurately on the backend');
  } catch (err) {
    fail('My Bookings API tests', err);
  } finally {
    if (upcomingB?.id) await prisma.booking.delete({ where: { id: upcomingB.id } }).catch(() => {});
    if (pendingB?.id) await prisma.booking.delete({ where: { id: pendingB.id } }).catch(() => {});
    if (completedB?.id) await prisma.booking.delete({ where: { id: completedB.id } }).catch(() => {});
  }
}

async function main() {
  try {
    await setup();
    await runRescheduleTests();
    await runCancellationTests();
    await runEndEarlyTests();
    await runExtensionTests();
    await runAutoCompletionTests();
    await runMyBookingsApiTests();

    console.log('\n======================================================');
    console.log(`🏁 R6 TEST SUITE FINISHED: ${testPassed} PASSED, ${testFailed} FAILED`);
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
