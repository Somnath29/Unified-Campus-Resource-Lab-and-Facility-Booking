import { prisma } from '../apps/backend/src/lib/prisma';
import {
  BookingStatus,
  Role,
  ResourceCategory,
  PriorityLevel,
  ActivityType,
} from '@prisma/client';
import { getAuthorizedDepartmentIds } from '../apps/backend/src/services/approvalService';
import { processSlaEscalationsAndExpiries } from '../apps/backend/src/services/slaEscalation.service';

async function runP7Tests() {
  console.log('--- STARTING P7 DELEGATION & SLA ESCALATION TEST SUITE ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${detail || ''}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // 1. Fixtures Setup
    // -------------------------------------------------------------------------
    console.log('\n1. Setting up P7 Fixtures...');
    const testDept = await prisma.department.upsert({
      where: { code: 'P7_DEPT' },
      update: {},
      create: { code: 'P7_DEPT', name: 'P7 Department of Automation' },
    });

    const otherDept = await prisma.department.upsert({
      where: { code: 'P7_OTHER' },
      update: {},
      create: { code: 'P7_OTHER', name: 'P7 Other Department' },
    });

    // Department policy with 2-hour SLA and escalation to ADMINISTRATOR
    await prisma.departmentPolicy.upsert({
      where: { department: testDept.name },
      update: {
        approvalSlaHours: 2,
        escalateToRole: Role.ADMINISTRATOR,
      },
      create: {
        department: testDept.name,
        departmentId: testDept.id,
        approvalSlaHours: 2,
        escalateToRole: Role.ADMINISTRATOR,
      },
    });

    const approverA = await prisma.user.upsert({
      where: { email: 'p7_approver_a@lpu.in' },
      update: { isAway: false, awayMessage: null },
      create: {
        email: 'p7_approver_a@lpu.in',
        name: 'P7 Approver Alice',
        passwordHash: 'dummy',
        role: Role.DEPARTMENT_APPROVER,
        department: testDept.name,
        departmentId: testDept.id,
      },
    });

    const approverB = await prisma.user.upsert({
      where: { email: 'p7_delegate_b@lpu.in' },
      update: { isAway: false, awayMessage: null },
      create: {
        email: 'p7_delegate_b@lpu.in',
        name: 'P7 Delegate Bob',
        passwordHash: 'dummy',
        role: Role.FACULTY,
        department: otherDept.name,
        departmentId: otherDept.id,
      },
    });

    const admin = await prisma.user.upsert({
      where: { email: 'p7_admin@lpu.in' },
      update: {},
      create: {
        email: 'p7_admin@lpu.in',
        name: 'P7 Admin Charlie',
        passwordHash: 'dummy',
        role: Role.ADMINISTRATOR,
        department: 'Central Administration',
      },
    });

    const requester = await prisma.user.upsert({
      where: { email: 'p7_student@lpu.in' },
      update: {},
      create: {
        email: 'p7_student@lpu.in',
        name: 'P7 Student David',
        passwordHash: 'dummy',
        role: Role.STUDENT,
        department: testDept.name,
        departmentId: testDept.id,
      },
    });

    // Assign approverA to testDept
    await prisma.approverAssignment.upsert({
      where: {
        userId_departmentId: {
          userId: approverA.id,
          departmentId: testDept.id,
        },
      },
      update: {},
      create: {
        userId: approverA.id,
        departmentId: testDept.id,
        isPrimary: true,
      },
    });

    const testResource = await prisma.resource.upsert({
      where: { code: 'P7_ROOM_101' },
      update: {},
      create: {
        code: 'P7_ROOM_101',
        name: 'P7 Innovation Lab',
        category: ResourceCategory.LAB,
        department: testDept.name,
        departmentId: testDept.id,
        building: 'Block P7',
        requiresApproval: true,
        imageUrl: 'http://example.com/p7.jpg',
      },
    });

    // Clean up any existing delegations for test accounts
    await prisma.delegation.deleteMany({
      where: {
        OR: [
          { fromUserId: approverA.id },
          { toUserId: approverB.id },
        ],
      },
    });

    // -------------------------------------------------------------------------
    // 2. Testing Department Authorization & Away Status
    // -------------------------------------------------------------------------
    console.log('\n2. Testing Department Authorization & Away Status...');

    // 2a. Approver A active (not away) has access to testDept
    let deptIdsA = await getAuthorizedDepartmentIds(approverA as any);
    assert(deptIdsA !== null && deptIdsA.includes(testDept.id), 'Active Approver A has access to assigned department');

    // 2b. Delegate B currently has no access to testDept
    let deptIdsB = await getAuthorizedDepartmentIds(approverB as any);
    assert(deptIdsB !== null && !deptIdsB.includes(testDept.id), 'Delegate B initially has NO access to testDept');

    // 2c. Set Approver A to Away
    await prisma.user.update({
      where: { id: approverA.id },
      data: { isAway: true, awayMessage: 'On academic conference' },
    });

    deptIdsA = await getAuthorizedDepartmentIds(approverA as any);
    assert(deptIdsA !== null && !deptIdsA.includes(testDept.id), 'Approver A with isAway=true yields no direct departmental approval authority');

    // 2d. Create active Delegation from Approver A to Approver B
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const oneDayLater = new Date(now.getTime() + 86400000);

    const delegation = await prisma.delegation.create({
      data: {
        fromUserId: approverA.id,
        toUserId: approverB.id,
        departmentId: testDept.id,
        startsAt: oneHourAgo,
        endsAt: oneDayLater,
      },
    });

    deptIdsB = await getAuthorizedDepartmentIds(approverB as any);
    assert(deptIdsB !== null && deptIdsB.includes(testDept.id), 'Delegate B gains authorized access to testDept via active delegation');

    // 2e. Revoke delegation
    await prisma.delegation.update({
      where: { id: delegation.id },
      data: { revokedAt: now },
    });

    deptIdsB = await getAuthorizedDepartmentIds(approverB as any);
    assert(deptIdsB !== null && !deptIdsB.includes(testDept.id), 'Revoked delegation immediately removes access from delegate B');

    // Restore Approver A isAway = false
    await prisma.user.update({
      where: { id: approverA.id },
      data: { isAway: false, awayMessage: null },
    });

    // -------------------------------------------------------------------------
    // 3. Testing SLA Escalation Logic & Idempotency
    // -------------------------------------------------------------------------
    console.log('\n3. Testing SLA Escalation...');

    // Clean up any test bookings
    await prisma.booking.deleteMany({
      where: { bookingNumber: { startsWith: 'P7-TEST-' } },
    });

    // Create a pending booking that has exceeded SLA (slaDueAt was 1 hour ago, startTime is tomorrow)
    const futureStart = new Date(now.getTime() + 86400000);
    const futureEnd = new Date(futureStart.getTime() + 7200000);
    const pastSla = new Date(now.getTime() - 3600000);

    const overdueBooking = await prisma.booking.create({
      data: {
        bookingNumber: 'P7-TEST-SLA-1',
        userId: requester.id,
        resourceId: testResource.id,
        departmentId: testDept.id,
        startTime: futureStart,
        endTime: futureEnd,
        purpose: 'Overdue Project Work',
        activityType: ActivityType.PROJECT_WORK,
        status: BookingStatus.PENDING,
        slaDueAt: pastSla,
        slaEscalated: false,
      },
    });

    // Run scheduler process
    const run1 = await processSlaEscalationsAndExpiries();
    assert(run1.escalatedCount >= 1, 'SLA scheduler identified and escalated overdue booking');

    // Verify booking state in DB
    const escalatedBooking = await prisma.booking.findUnique({
      where: { id: overdueBooking.id },
      include: { approvalDecisions: true },
    });

    assert(escalatedBooking?.slaEscalated === true, 'Booking is marked slaEscalated: true');
    assert(escalatedBooking?.slaEscalatedAt !== null, 'Booking has slaEscalatedAt timestamp set');
    assert(
      escalatedBooking?.approvalDecisions.some((d) => d.action === 'ESCALATE_SLA'),
      'Created ApprovalDecision record with action ESCALATE_SLA'
    );

    // Verify notifications were delivered to admin
    const adminNotification = await prisma.notification.findFirst({
      where: {
        userId: admin.id,
        title: { contains: '[SLA ESCALATION]' },
      },
    });
    assert(adminNotification !== null, 'Delivered SLA escalation notification to ADMINISTRATOR');

    // 3b. Verify Idempotency - running scheduler again should NOT re-escalate
    const run2 = await processSlaEscalationsAndExpiries();
    assert(run2.escalatedCount === 0, 'Scheduler idempotency: second pass does not re-escalate already escalated booking');

    // -------------------------------------------------------------------------
    // 4. Testing Automatic Expiry of Unreviewed Past Requests
    // -------------------------------------------------------------------------
    console.log('\n4. Testing Automatic Expiry of Past Requests...');

    // Create a pending booking whose event start time has already passed
    const pastStartTime = new Date(now.getTime() - 7200000);
    const pastEndTime = new Date(now.getTime() - 3600000);

    const expiredBooking = await prisma.booking.create({
      data: {
        bookingNumber: 'P7-TEST-EXPIRE-1',
        userId: requester.id,
        resourceId: testResource.id,
        departmentId: testDept.id,
        startTime: pastStartTime,
        endTime: pastEndTime,
        purpose: 'Forgotten Event',
        activityType: ActivityType.CLUB_EVENT,
        status: BookingStatus.PENDING,
        slaDueAt: new Date(now.getTime() - 10000000),
      },
    });

    const expiryRun = await processSlaEscalationsAndExpiries();
    assert(expiryRun.expiredCount >= 1, 'Scheduler auto-expired unreviewed booking whose startTime passed');

    const freshExpired = await prisma.booking.findUnique({
      where: { id: expiredBooking.id },
      include: { approvalDecisions: true },
    });

    assert(freshExpired?.status === BookingStatus.REJECTED, 'Expired booking is marked REJECTED');
    assert(
      freshExpired?.rejectionReason?.includes('start time passed'),
      'Rejection reason records start time passed'
    );
    assert(
      freshExpired?.approvalDecisions.some((d) => d.action === 'AUTO_REJECT_EXPIRED'),
      'Created ApprovalDecision record with action AUTO_REJECT_EXPIRED'
    );

    // Clean up test bookings
    await prisma.booking.deleteMany({
      where: { bookingNumber: { startsWith: 'P7-TEST-' } },
    });

    console.log('\n======================================================');
    console.log(`P7 TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error in P7 test suite:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runP7Tests();
