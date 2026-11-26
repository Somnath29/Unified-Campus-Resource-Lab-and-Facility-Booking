/**
 * Comprehensive Automated Test Suite for R1: Production-Grade Booking Service
 * Run with: npx tsx apps/web/test/booking-r1.test.ts
 */

import crypto from 'crypto';
import { prisma } from '../src/lib/prisma';
import { BookingService } from '../src/services/bookingService';
import { BookingStatus, Role, PriorityLevel, ActivityType } from '@prisma/client';
import {
  isValidBookingTransition,
  validateBookingTransition,
  canCancelBooking,
  InvalidStateTransitionError,
} from '@lpu/shared';
import { ApiError } from '../src/lib/auth';

const BASE_URL = 'http://localhost:3000';

interface TestUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: string;
  token?: string;
}

let studentUser: TestUser;
let otherStudentUser: TestUser;
let facultyUser: TestUser;
let approverUser: TestUser;
let otherDeptApproverUser: TestUser;
let adminUser: TestUser;

let testResource: any;
let approvalRequiredResource: any;

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failedTests++;
    console.error(`  ❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  } else {
    passedTests++;
    console.log(`  ✓ PASSED: ${message}`);
  }
}

import { signToken } from '../src/lib/auth';

async function loginUser(email: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`User ${email} not found.`);
  return signToken({ id: user.id, email: user.email, role: user.role });
}

async function setup() {
  console.log('\n======================================================');
  console.log('🚀 INITIALIZING R1 TEST ENVIRONMENT & SEED DATA');
  console.log('======================================================\n');

  // Clean up any leftovers from previous test runs
  await prisma.idempotencyKey.deleteMany({
    where: { key: { startsWith: 'concurrency-test-key-' } },
  });
  await prisma.idempotencyKey.deleteMany({
    where: { key: { startsWith: 'idemp-key-' } },
  });
  await prisma.booking.deleteMany({
    where: {
      purpose: {
        in: [
          'Faculty Research Consultation',
          'Student Society Annual Hackathon',
          'Ownership security test booking',
          'Idempotency verification booking',
          'State machine cancellation test',
        ],
      },
    },
  });
  await prisma.booking.deleteMany({
    where: { purpose: { startsWith: 'Concurrent test attempt' } },
  });

  // Load existing test users
  const student = await prisma.user.findUnique({ where: { email: 'ketan.12204598@lpu.in' } });
  const faculty = await prisma.user.findUnique({ where: { email: 'arvind.cse@lpu.in' } });
  const approver = await prisma.user.findUnique({ where: { email: 'approver.sece@lpu.in' } });
  const admin = await prisma.user.findUnique({ where: { email: 'admin.estate@lpu.in' } });

  if (!student || !faculty || !approver || !admin) {
    throw new Error('Seed users missing. Run npm run db:seed first.');
  }

  // Create an extra student for ownership testing
  let otherStudent = await prisma.user.findUnique({ where: { email: 'other.student@lpu.in' } });
  if (!otherStudent) {
    otherStudent = await prisma.user.create({
      data: {
        email: 'other.student@lpu.in',
        name: 'Other Student',
        passwordHash: student.passwordHash,
        role: Role.STUDENT,
        department: 'School of Computer Science & Engineering',
      },
    });
  }

  // Create an out-of-scope department approver
  let otherApprover = await prisma.user.findUnique({ where: { email: 'other.approver@lpu.in' } });
  if (!otherApprover) {
    otherApprover = await prisma.user.create({
      data: {
        email: 'other.approver@lpu.in',
        name: 'Mechanical Approver',
        passwordHash: approver.passwordHash,
        role: Role.DEPARTMENT_APPROVER,
        department: 'School of Mechanical Engineering',
      },
    });
  }

  studentUser = { ...student, token: await loginUser(student.email) };
  otherStudentUser = { ...otherStudent, token: await loginUser(otherStudent.email) };
  facultyUser = { ...faculty, token: await loginUser(faculty.email) };
  approverUser = { ...approver, token: await loginUser(approver.email) };
  otherDeptApproverUser = { ...otherApprover, token: await loginUser(otherApprover.email) };
  adminUser = { ...admin, token: await loginUser(admin.email) };

  // Fetch test resources
  testResource = await prisma.resource.findFirst({
    where: { code: 'CSE-CR-204', requiresApproval: false, deletedAt: null },
  }) || await prisma.resource.findFirst({
    where: { category: 'CLASSROOM', requiresApproval: false, deletedAt: null },
  });
  approvalRequiredResource = await prisma.resource.findFirst({
    where: { code: 'CSE-LAB-03', requiresApproval: true, deletedAt: null },
  }) || await prisma.resource.findFirst({
    where: { requiresApproval: true, deletedAt: null },
  });

  if (!testResource || !approvalRequiredResource) {
    throw new Error('Required test resources not found.');
  }

  console.log(`Using Resource: ${testResource.name} (Requires Approval: ${testResource.requiresApproval})`);
  console.log(`Using Approval Resource: ${approvalRequiredResource.name} (Requires Approval: ${approvalRequiredResource.requiresApproval})\n`);
}

/**
 * -------------------------------------------------------------
 * SUITE A: Booking Validation Tests
 * -------------------------------------------------------------
 */
async function testBookingValidations() {
  console.log('\n--- SUITE A: BOOKING VALIDATION TESTS ---');

  // A1: Resource does not exist
  try {
    await BookingService.createBooking({
      user: studentUser,
      input: {
        resourceId: '00000000-0000-0000-0000-000000000000',
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 90000000).toISOString(),
        purpose: 'Non-existent resource test',
      },
    });
    assert(false, 'Should have failed for non-existent resource');
  } catch (err: any) {
    assert(err.status === 404, 'Non-existent resource rejected with 404');
  }

  // A2: Resource is soft-deleted
  const softDeletedRes = await prisma.resource.create({
    data: {
      code: `TEST-SOFT-${Date.now()}`,
      name: 'Soft Deleted Room',
      category: 'CLASSROOM',
      department: 'School of Computer Science & Engineering',
      building: 'Block 34',
      capacity: 30,
      imageUrl: 'https://example.com/img.jpg',
      deletedAt: new Date(),
    },
  });

  try {
    await BookingService.createBooking({
      user: studentUser,
      input: {
        resourceId: softDeletedRes.id,
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 90000000).toISOString(),
        purpose: 'Soft-deleted test',
      },
    });
    assert(false, 'Should have failed for soft-deleted resource');
  } catch (err: any) {
    assert(err.status === 404, 'Soft-deleted resource rejected with 404');
  }

  // A3: Resource is under maintenance
  const maintenanceRes = await prisma.resource.create({
    data: {
      code: `TEST-MAINT-${Date.now()}`,
      name: 'Maintenance Room',
      category: 'CLASSROOM',
      department: 'School of Computer Science & Engineering',
      building: 'Block 34',
      capacity: 30,
      imageUrl: 'https://example.com/img.jpg',
      isUnderMaintenance: true,
      maintenanceReason: 'HVAC repair',
    },
  });

  try {
    await BookingService.createBooking({
      user: studentUser,
      input: {
        resourceId: maintenanceRes.id,
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 90000000).toISOString(),
        purpose: 'Maintenance test',
      },
    });
    assert(false, 'Should have failed for maintenance resource');
  } catch (err: any) {
    assert(err.status === 400 && err.message.includes('maintenance'), 'Maintenance resource rejected with 400');
  }

  // A4: Attendance exceeds capacity
  try {
    await BookingService.createBooking({
      user: studentUser,
      input: {
        resourceId: testResource.id,
        startTime: new Date(Date.now() + 86400000).toISOString(),
        endTime: new Date(Date.now() + 90000000).toISOString(),
        purpose: 'Capacity overflow test',
        expectedAttendance: testResource.capacity + 50,
      },
    });
    assert(false, 'Should have failed when attendance exceeds capacity');
  } catch (err: any) {
    assert(err.status === 400 && err.message.includes('capacity'), 'Exceeding capacity rejected with 400');
  }

  // A5: Invalid duration: end time before start time
  try {
    const future = new Date(Date.now() + 86400000);
    await BookingService.createBooking({
      user: studentUser,
      input: {
        resourceId: testResource.id,
        startTime: future.toISOString(),
        endTime: new Date(future.getTime() - 3600000).toISOString(),
        purpose: 'Inverted time test',
      },
    });
    assert(false, 'Should have failed when end time <= start time');
  } catch (err: any) {
    assert(err.status === 400, 'End time before start time rejected with 400');
  }

  // A6: Duration exceeds maximum 8 hours
  try {
    const future = new Date(Date.now() + 86400000);
    await BookingService.createBooking({
      user: studentUser,
      input: {
        resourceId: testResource.id,
        startTime: future.toISOString(),
        endTime: new Date(future.getTime() + 10 * 3600000).toISOString(),
        purpose: 'Excessive duration test',
      },
    });
    assert(false, 'Should have failed when duration > 8 hours');
  } catch (err: any) {
    assert(err.status === 400 && err.message.includes('8 hours'), 'Duration > 8 hours rejected with 400');
  }

  // A7: Timetable conflict rejection
  // Add a timetable entry for Monday 10:00 - 11:30 for testResource
  const timetableEntry = await prisma.timetableEntry.create({
    data: {
      resourceId: testResource.id,
      courseCode: 'CSE301',
      courseName: 'Algorithms Lecture',
      instructorName: 'Dr. Sharma',
      dayOfWeek: 1, // Monday
      startTime: '10:00',
      endTime: '11:30',
      department: testResource.department,
      semester: '5',
      section: 'K22AA',
    },
  });

  // Calculate next Monday at 10:15 AM Kolkata time
  // In Kolkata (+05:30), UTC time for 10:15 AM is 04:45 AM UTC
  const nextMonday = new Date();
  const day = nextMonday.getUTCDay();
  const daysUntilNextMon = ((8 - day) % 7 || 7);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilNextMon);
  nextMonday.setUTCHours(4, 45, 0, 0); // 10:15 AM IST
  const monEnd = new Date(nextMonday.getTime() + 45 * 60000); // 11:00 AM IST

  try {
    await BookingService.createBooking({
      user: studentUser,
      input: {
        resourceId: testResource.id,
        startTime: nextMonday.toISOString(),
        endTime: monEnd.toISOString(),
        purpose: 'Timetable collision test',
      },
    });
    assert(false, 'Should have failed for academic timetable conflict');
  } catch (err: any) {
    assert(err.status === 409 && err.message.includes('Academic Timetable Conflict'), 'Timetable conflict rejected with 409');
  } finally {
    await prisma.timetableEntry.delete({ where: { id: timetableEntry.id } });
  }

  // A8: Maximum advance booking days exceeded
  try {
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 90); // 90 days ahead
    await BookingService.createBooking({
      user: studentUser,
      input: {
        resourceId: testResource.id,
        startTime: farFuture.toISOString(),
        endTime: new Date(farFuture.getTime() + 3600000).toISOString(),
        purpose: 'Far future advance test',
      },
    });
    assert(false, 'Should have failed for booking beyond advance window');
  } catch (err: any) {
    assert(err.status === 422 || err.status === 400, 'Advance window exceeded rejected with 422/400');
  }

  // A9: Automatically confirmed booking (faculty or short student booking on non-approval resource)
  const validSlot = new Date();
  validSlot.setDate(validSlot.getDate() + 3);
  validSlot.setUTCHours(8, 30, 0, 0); // 2:00 PM IST
  const validSlotEnd = new Date(validSlot.getTime() + 3600000); // 1 hour

  const autoBooking = await BookingService.createBooking({
    user: facultyUser,
    input: {
      resourceId: testResource.id,
      startTime: validSlot.toISOString(),
      endTime: validSlotEnd.toISOString(),
      purpose: 'Faculty Research Consultation',
    },
  });
  assert(autoBooking.booking.status === BookingStatus.CONFIRMED, 'Faculty booking automatically confirmed');
  assert(autoBooking.booking.bookingNumber.startsWith('LPU-'), 'Booking number has LPU- prefix');
  assert(autoBooking.booking.checkInToken.length === 6, 'Check-in token is 6 digits');

  // A10: Booking requiring approval (student booking on approval-required resource)
  const approvalSlot = new Date();
  approvalSlot.setDate(approvalSlot.getDate() + 4);
  approvalSlot.setUTCHours(9, 30, 0, 0); // 3:00 PM IST
  const approvalSlotEnd = new Date(approvalSlot.getTime() + 3600000);

  const pendingBooking = await BookingService.createBooking({
    user: studentUser,
    input: {
      resourceId: approvalRequiredResource.id,
      startTime: approvalSlot.toISOString(),
      endTime: approvalSlotEnd.toISOString(),
      purpose: 'Student Society Annual Hackathon',
    },
  });
  assert(pendingBooking.booking.status === BookingStatus.PENDING, 'Student request requiring approval is set to PENDING');
}

/**
 * -------------------------------------------------------------
 * SUITE B: Mandatory 20-Request Double-Booking Concurrency Test
 * -------------------------------------------------------------
 */
async function testDoubleBookingConcurrency() {
  console.log('\n--- SUITE B: 20 CONCURRENT BOOKINGS DOUBLE-BOOKING ACCEPTANCE TEST ---');

  // Choose a clean future slot: Day + 5 at 11:00 AM UTC (4:30 PM IST)
  const slotStart = new Date();
  slotStart.setDate(slotStart.getDate() + 5);
  slotStart.setUTCHours(11, 0, 0, 0);
  const slotEnd = new Date(slotStart.getTime() + 2 * 3600000); // 2 hours

  // Ensure window is completely clear before firing concurrent requests
  await prisma.booking.deleteMany({
    where: {
      resourceId: testResource.id,
      startTime: slotStart,
      endTime: slotEnd,
    },
  });

  console.log(`Firing 20 concurrent requests for Resource ${testResource.name}`);
  console.log(`Time window: ${slotStart.toISOString()} -> ${slotEnd.toISOString()}`);

  const totalRequests = 20;
  const requests = Array.from({ length: totalRequests }).map((_, idx) => {
    const key = `concurrency-test-key-${idx}-${Date.now()}`;
    return fetch(`${BASE_URL}/api/bookings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentUser.token}`,
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        resourceId: testResource.id,
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
        purpose: `Concurrent test attempt #${idx + 1}`,
        activityType: 'PROJECT_WORK',
        expectedAttendance: 10,
      }),
    });
  });

  const responses = await Promise.all(requests);
  const statuses = responses.map((r) => r.status);
  const responseTexts = await Promise.all(responses.map(r => r.text()));
  console.log(`Sample response status: ${statuses[0]}, body: ${responseTexts[0]}`);

  const count201 = statuses.filter((s) => s === 201).length;
  const count409 = statuses.filter((s) => s === 409).length;

  console.log(`Results: ${count201} requests returned 201 Created; ${count409} requests returned 409 Conflict.`);

  assert(count201 === 1, `Exactly ONE request succeeded with HTTP 201 (got ${count201})`);
  assert(count409 === 19, `Exactly NINETEEN requests failed with HTTP 409 Conflict (got ${count409})`);

  // Verify database state directly in PostgreSQL
  const activeBookings = await prisma.booking.findMany({
    where: {
      resourceId: testResource.id,
      startTime: slotStart,
      endTime: slotEnd,
      status: { in: [BookingStatus.PENDING, BookingStatus.APPROVED, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
    },
  });

  assert(activeBookings.length === 1, `Exactly ONE active booking exists in PostgreSQL database (got ${activeBookings.length})`);
  assert(activeBookings[0].bookingNumber.startsWith('LPU-'), 'Booking number matches sequence format LPU-YYYY-000123');
  assert(activeBookings[0].checkInToken?.length === 6, 'Check-in token is valid 6-digit PIN');
}

/**
 * -------------------------------------------------------------
 * SUITE C: Idempotency Tests
 * -------------------------------------------------------------
 */
async function testIdempotency() {
  console.log('\n--- SUITE C: IDEMPOTENCY TESTS ---');

  const testKey = `idemp-key-${Date.now()}`;
  const slotStart = new Date();
  slotStart.setDate(slotStart.getDate() + 6);
  slotStart.setUTCHours(9, 0, 0, 0); // 2:30 PM IST
  const slotEnd = new Date(slotStart.getTime() + 3600000);

  const payload = {
    resourceId: testResource.id,
    startTime: slotStart.toISOString(),
    endTime: slotEnd.toISOString(),
    purpose: 'Idempotency verification booking',
    activityType: 'CLASS_LECTURE',
    expectedAttendance: 15,
  };

  // C1: First request with key -> 201
  const res1 = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${studentUser.token}`,
      'Idempotency-Key': testKey,
    },
    body: JSON.stringify(payload),
  });
  const data1 = await res1.json();
  assert(res1.status === 201, 'First request with Idempotency-Key returns 201 Created');
  const originalBookingId = data1.booking.id;

  // C2: Repeat request with same key and identical payload -> 200 OK with identical booking
  const res2 = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${studentUser.token}`,
      'Idempotency-Key': testKey,
    },
    body: JSON.stringify(payload),
  });
  const data2 = await res2.json();
  assert(res2.status === 200, 'Repeating request with same key returns HTTP 200 OK');
  assert(data2.booking.id === originalBookingId, 'Returned booking ID is identical to original booking');
  assert(data2.booking.bookingNumber === data1.booking.bookingNumber, 'Returned booking number is identical');

  // C3: Same key with DIFFERENT payload -> 409 Conflict
  const res3 = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${studentUser.token}`,
      'Idempotency-Key': testKey,
    },
    body: JSON.stringify({
      ...payload,
      purpose: 'Tampered purpose with same key',
    }),
  });
  assert(res3.status === 409, 'Reusing key with different payload rejected with 409 Conflict');

  // C4: Missing Idempotency-Key header is rejected with 400 Bad Request
  const res4 = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${studentUser.token}`,
    },
    body: JSON.stringify(payload),
  });
  assert(res4.status === 400, 'Missing Idempotency-Key rejected with 400 Bad Request');
}

/**
 * -------------------------------------------------------------
 * SUITE D: Permission & Authorization Tests
 * -------------------------------------------------------------
 */
async function testPermissions() {
  console.log('\n--- SUITE D: PERMISSION & AUTHORIZATION TESTS ---');

  // Create a booking owned by studentUser
  const slotStart = new Date();
  slotStart.setDate(slotStart.getDate() + 7);
  slotStart.setUTCHours(10, 0, 0, 0);
  const slotEnd = new Date(slotStart.getTime() + 3600000);

  const bookingResult = await BookingService.createBooking({
    user: studentUser,
    input: {
      resourceId: testResource.id,
      startTime: slotStart.toISOString(),
      endTime: slotEnd.toISOString(),
      purpose: 'Ownership security test booking',
    },
  });
  const bookingId = bookingResult.booking.id;

  // D1: Owner can view booking
  const resOwner = await fetch(`${BASE_URL}/api/bookings/${bookingId}`, {
    headers: { Authorization: `Bearer ${studentUser.token}` },
  });
  assert(resOwner.status === 200, 'Booking owner can view their booking');

  // D2: Another student cannot view booking (403 Forbidden)
  const resOtherStudent = await fetch(`${BASE_URL}/api/bookings/${bookingId}`, {
    headers: { Authorization: `Bearer ${otherStudentUser.token}` },
  });
  assert(resOtherStudent.status === 403, 'Another student cannot view booking (403 Forbidden)');

  // D3: Faculty cannot view other user booking unless approver/admin
  const resFaculty = await fetch(`${BASE_URL}/api/bookings/${bookingId}`, {
    headers: { Authorization: `Bearer ${facultyUser.token}` },
  });
  assert(resFaculty.status === 403, 'Faculty cannot view other users booking merely because of faculty role (403)');

  // D4: Department approver in scope can view booking
  const resApprover = await fetch(`${BASE_URL}/api/bookings/${bookingId}`, {
    headers: { Authorization: `Bearer ${approverUser.token}` },
  });
  assert(resApprover.status === 200, 'Authorized department approver can view booking');

  // D5: Out-of-scope department approver cannot view booking (403)
  const resOtherApprover = await fetch(`${BASE_URL}/api/bookings/${bookingId}`, {
    headers: { Authorization: `Bearer ${otherDeptApproverUser.token}` },
  });
  assert(resOtherApprover.status === 403, 'Out-of-scope department approver is rejected with 403 Forbidden');

  // D6: Administrator can view any booking
  const resAdmin = await fetch(`${BASE_URL}/api/bookings/${bookingId}`, {
    headers: { Authorization: `Bearer ${adminUser.token}` },
  });
  assert(resAdmin.status === 200, 'Administrator can view any campus booking');

  // D7: Another student cannot cancel someone elses booking
  const resOtherCancel = await fetch(`${BASE_URL}/api/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${otherStudentUser.token}`,
    },
    body: JSON.stringify({ reason: 'Malicious cancellation attempt' }),
  });
  assert(resOtherCancel.status === 403, 'Unauthorized student cancellation rejected with 403 Forbidden');

  // D8: Owner can cancel their booking
  const resOwnerCancel = await fetch(`${BASE_URL}/api/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${studentUser.token}`,
    },
    body: JSON.stringify({ reason: 'Legitimate owner cancellation' }),
  });
  assert(resOwnerCancel.status === 200, 'Booking owner can cancel their booking');
}

/**
 * -------------------------------------------------------------
 * SUITE E: State Machine Tests
 * -------------------------------------------------------------
 */
async function testStateMachine() {
  console.log('\n--- SUITE E: BOOKING STATE MACHINE TESTS ---');

  // E1: Valid transitions
  assert(isValidBookingTransition('PENDING', 'APPROVED') === true, 'PENDING -> APPROVED is valid');
  assert(isValidBookingTransition('PENDING', 'CONFIRMED') === true, 'PENDING -> CONFIRMED is valid');
  assert(isValidBookingTransition('PENDING', 'REJECTED') === true, 'PENDING -> REJECTED is valid');
  assert(isValidBookingTransition('PENDING', 'CANCELLED') === true, 'PENDING -> CANCELLED is valid');
  assert(isValidBookingTransition('APPROVED', 'CONFIRMED') === true, 'APPROVED -> CONFIRMED is valid');
  assert(isValidBookingTransition('APPROVED', 'CANCELLED') === true, 'APPROVED -> CANCELLED is valid');
  assert(isValidBookingTransition('CONFIRMED', 'CHECKED_IN') === true, 'CONFIRMED -> CHECKED_IN is valid');
  assert(isValidBookingTransition('CONFIRMED', 'NO_SHOW') === true, 'CONFIRMED -> NO_SHOW is valid');
  assert(isValidBookingTransition('CONFIRMED', 'CANCELLED') === true, 'CONFIRMED -> CANCELLED is valid');
  assert(isValidBookingTransition('CHECKED_IN', 'COMPLETED') === true, 'CHECKED_IN -> COMPLETED is valid');

  // E2: Invalid transitions
  assert(isValidBookingTransition('COMPLETED', 'CANCELLED') === false, 'COMPLETED -> CANCELLED is invalid');
  assert(isValidBookingTransition('CANCELLED', 'CONFIRMED') === false, 'CANCELLED -> CONFIRMED is invalid');
  assert(isValidBookingTransition('REJECTED', 'APPROVED') === false, 'REJECTED -> APPROVED is invalid');
  assert(isValidBookingTransition('NO_SHOW', 'CHECKED_IN') === false, 'NO_SHOW -> CHECKED_IN is invalid');

  // E3: validateBookingTransition throws on invalid transition
  try {
    validateBookingTransition('COMPLETED', 'CANCELLED');
    assert(false, 'Should have thrown InvalidStateTransitionError');
  } catch (err: any) {
    assert(err instanceof InvalidStateTransitionError, 'validateBookingTransition throws InvalidStateTransitionError');
  }

  // E4: canCancelBooking checks
  assert(canCancelBooking('PENDING') === true, 'PENDING can be cancelled');
  assert(canCancelBooking('CONFIRMED') === true, 'CONFIRMED can be cancelled');
  assert(canCancelBooking('COMPLETED') === false, 'COMPLETED cannot be cancelled');
  assert(canCancelBooking('CANCELLED') === false, 'CANCELLED cannot be cancelled');

  // E5: Database rejection of cancelling an already cancelled booking
  const slotStart = new Date();
  slotStart.setDate(slotStart.getDate() + 8);
  slotStart.setUTCHours(12, 0, 0, 0);
  const slotEnd = new Date(slotStart.getTime() + 3600000);

  const b = await BookingService.createBooking({
    user: studentUser,
    input: {
      resourceId: testResource.id,
      startTime: slotStart.toISOString(),
      endTime: slotEnd.toISOString(),
      purpose: 'State machine cancellation test',
    },
  });

  // Cancel once -> success
  await BookingService.cancelBooking(b.booking.id, studentUser);

  // Cancel second time -> rejected by state machine
  try {
    await BookingService.cancelBooking(b.booking.id, studentUser);
    assert(false, 'Cancelling already cancelled booking should fail');
  } catch (err: any) {
    assert(err.status === 400, 'Cancelling already cancelled booking rejected with 400 Bad Request');
  }
}

async function runAllTests() {
  try {
    await setup();
    await testBookingValidations();
    await testDoubleBookingConcurrency();
    await testIdempotency();
    await testPermissions();
    await testStateMachine();

    console.log('\n======================================================');
    console.log(`🎉 ALL R1 TESTS COMPLETED SUCCESSFULLY!`);
    console.log(`   Passed: ${passedTests}`);
    console.log(`   Failed: ${failedTests}`);
    console.log('======================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST RUNNER ABORTED WITH ERROR:\n', err);
    process.exit(1);
  }
}

runAllTests();
