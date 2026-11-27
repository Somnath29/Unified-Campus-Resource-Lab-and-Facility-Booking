import { prisma } from '../apps/backend/src/lib/prisma';
import {
  BookingStatus,
  Role,
  ResourceCategory,
  PriorityLevel,
  ActivityType,
} from '@prisma/client';
import {
  getDepartmentInsights,
  sendPolicyChangeRequest,
  addNoShowInternalNote,
  clearInsightsCache,
} from '../apps/backend/src/services/insights.service';

async function runP9Tests() {
  console.log('--- STARTING P9 DEPARTMENT UTILISATION INSIGHTS TEST SUITE ---');
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
    // 1. Setup Test Fixtures
    // -------------------------------------------------------------------------
    console.log('\n1. Setting up P9 Database Fixtures...');

    const deptA = await prisma.department.upsert({
      where: { code: 'P9_DEPT_A' },
      update: {},
      create: { code: 'P9_DEPT_A', name: 'P9 School of Robotics' },
    });

    const deptB = await prisma.department.upsert({
      where: { code: 'P9_DEPT_B' },
      update: {},
      create: { code: 'P9_DEPT_B', name: 'P9 School of BioTech' },
    });

    const approverA = await prisma.user.upsert({
      where: { email: 'p9_approver_a@lpu.in' },
      update: { isAway: false },
      create: {
        email: 'p9_approver_a@lpu.in',
        name: 'P9 Approver Alice',
        passwordHash: 'dummy',
        role: Role.DEPARTMENT_APPROVER,
        department: deptA.name,
        departmentId: deptA.id,
      },
    });

    const approverB = await prisma.user.upsert({
      where: { email: 'p9_approver_b@lpu.in' },
      update: { isAway: false },
      create: {
        email: 'p9_approver_b@lpu.in',
        name: 'P9 Approver Bob',
        passwordHash: 'dummy',
        role: Role.DEPARTMENT_APPROVER,
        department: deptB.name,
        departmentId: deptB.id,
      },
    });

    const studentRepeatNoShow = await prisma.user.upsert({
      where: { email: 'p9_student_noshow@lpu.in' },
      update: {},
      create: {
        email: 'p9_student_noshow@lpu.in',
        name: 'P9 Student Flaky',
        passwordHash: 'dummy',
        role: Role.STUDENT,
        department: deptA.name,
        departmentId: deptA.id,
      },
    });

    const facultyUser = await prisma.user.upsert({
      where: { email: 'p9_faculty@lpu.in' },
      update: {},
      create: {
        email: 'p9_faculty@lpu.in',
        name: 'P9 Faculty Arvind',
        passwordHash: 'dummy',
        role: Role.FACULTY,
        department: deptA.name,
        departmentId: deptA.id,
      },
    });

    const adminUser = await prisma.user.upsert({
      where: { email: 'p9_admin@lpu.in' },
      update: {},
      create: {
        email: 'p9_admin@lpu.in',
        name: 'P9 Central Administrator',
        passwordHash: 'dummy',
        role: Role.ADMINISTRATOR,
        department: 'Central Administration',
      },
    });

    // Assign approverA to deptA only
    await prisma.approverAssignment.upsert({
      where: {
        userId_departmentId: {
          userId: approverA.id,
          departmentId: deptA.id,
        },
      },
      update: {},
      create: {
        userId: approverA.id,
        departmentId: deptA.id,
        isPrimary: true,
      },
    });

    // Assign approverB to deptB only
    await prisma.approverAssignment.upsert({
      where: {
        userId_departmentId: {
          userId: approverB.id,
          departmentId: deptB.id,
        },
      },
      update: {},
      create: {
        userId: approverB.id,
        departmentId: deptB.id,
        isPrimary: true,
      },
    });

    // Create 2 resources in Dept A (one busy, one idle)
    const resourceBusy = await prisma.resource.upsert({
      where: { code: 'P9_BUSY_LAB' },
      update: {},
      create: {
        code: 'P9_BUSY_LAB',
        name: 'P9 Advanced Robotics Lab',
        category: ResourceCategory.LAB,
        department: deptA.name,
        departmentId: deptA.id,
        building: 'Block P9',
        requiresApproval: true,
        imageUrl: 'http://example.com/p9-lab.jpg',
      },
    });

    const resourceIdle = await prisma.resource.upsert({
      where: { code: 'P9_IDLE_ROOM' },
      update: {},
      create: {
        code: 'P9_IDLE_ROOM',
        name: 'P9 Workshop 102',
        category: ResourceCategory.CLASSROOM,
        department: deptA.name,
        departmentId: deptA.id,
        building: 'Block P9',
        requiresApproval: true,
        imageUrl: 'http://example.com/p9-room.jpg',
      },
    });

    // Create 1 resource in Dept B
    const resourceForeign = await prisma.resource.upsert({
      where: { code: 'P9_BIO_LAB' },
      update: {},
      create: {
        code: 'P9_BIO_LAB',
        name: 'P9 BioTech Facility',
        category: ResourceCategory.LAB,
        department: deptB.name,
        departmentId: deptB.id,
        building: 'Block Bio',
        requiresApproval: true,
        imageUrl: 'http://example.com/p9-bio.jpg',
      },
    });

    // Clean up test bookings
    await prisma.booking.deleteMany({
      where: { bookingNumber: { startsWith: 'P9-TEST-' } },
    });

    // Seed Dept A Bookings:
    // Booking 1: CONFIRMED by faculty (4 hours, 10:00 to 14:00)
    const d1 = new Date();
    d1.setDate(d1.getDate() - 2);
    d1.setHours(10, 0, 0, 0);
    const d1End = new Date(d1);
    d1End.setHours(14, 0, 0, 0);

    const submitted1 = new Date(d1.getTime() - 7200000);
    const decided1 = new Date(d1.getTime() - 3600000); // 60 min decision time

    await prisma.booking.create({
      data: {
        bookingNumber: 'P9-TEST-001',
        userId: facultyUser.id,
        resourceId: resourceBusy.id,
        departmentId: deptA.id,
        startTime: d1,
        endTime: d1End,
        purpose: 'Robotics Workshop',
        status: BookingStatus.CHECKED_IN,
        submittedAt: submitted1,
        decidedAt: decided1,
      },
    });

    // Booking 2: NO_SHOW by studentRepeatNoShow (2 hours)
    const d2 = new Date();
    d2.setDate(d2.getDate() - 3);
    d2.setHours(14, 0, 0, 0);
    const d2End = new Date(d2);
    d2End.setHours(16, 0, 0, 0);

    await prisma.booking.create({
      data: {
        bookingNumber: 'P9-TEST-002',
        userId: studentRepeatNoShow.id,
        resourceId: resourceBusy.id,
        departmentId: deptA.id,
        startTime: d2,
        endTime: d2End,
        purpose: 'Club Project',
        status: BookingStatus.NO_SHOW,
        submittedAt: new Date(d2.getTime() - 5000000),
        decidedAt: new Date(d2.getTime() - 2000000),
      },
    });

    // Booking 3: Second NO_SHOW by studentRepeatNoShow (repeat offender!)
    const d3 = new Date();
    d3.setDate(d3.getDate() - 1);
    d3.setHours(11, 0, 0, 0);
    const d3End = new Date(d3);
    d3End.setHours(13, 0, 0, 0);

    await prisma.booking.create({
      data: {
        bookingNumber: 'P9-TEST-003',
        userId: studentRepeatNoShow.id,
        resourceId: resourceBusy.id,
        departmentId: deptA.id,
        startTime: d3,
        endTime: d3End,
        purpose: 'Second Session',
        status: BookingStatus.NO_SHOW,
        submittedAt: new Date(d3.getTime() - 5000000),
        decidedAt: new Date(d3.getTime() - 1000000),
      },
    });

    // Booking 4: REJECTED booking on resourceIdle (submitted 120 mins before decision)
    const d4 = new Date();
    d4.setDate(d4.getDate() - 4);
    d4.setHours(9, 0, 0, 0);
    const d4End = new Date(d4);
    d4End.setHours(10, 0, 0, 0);

    await prisma.booking.create({
      data: {
        bookingNumber: 'P9-TEST-004',
        userId: studentRepeatNoShow.id,
        resourceId: resourceIdle.id,
        departmentId: deptA.id,
        startTime: d4,
        endTime: d4End,
        purpose: 'Unattended Practice',
        status: BookingStatus.REJECTED,
        rejectionReason: 'Invalid documentation provided',
        submittedAt: new Date(d4.getTime() - 120 * 60000),
        decidedAt: d4, // 120 minutes decision time
      },
    });

    // Booking 5 in Dept B (Foreign Dept)
    const dB = new Date();
    dB.setDate(dB.getDate() - 1);
    dB.setHours(10, 0, 0, 0);
    const dBEnd = new Date(dB);
    dBEnd.setHours(12, 0, 0, 0);

    await prisma.booking.create({
      data: {
        bookingNumber: 'P9-TEST-FOREIGN-01',
        userId: studentRepeatNoShow.id,
        resourceId: resourceForeign.id,
        departmentId: deptB.id,
        startTime: dB,
        endTime: dBEnd,
        purpose: 'BioTech Experiment',
        status: BookingStatus.CONFIRMED,
        submittedAt: dB,
        decidedAt: dB,
      },
    });

    clearInsightsCache();

    // -------------------------------------------------------------------------
    // 2. Testing Department Scoping & Isolation
    // -------------------------------------------------------------------------
    console.log('\n2. Testing Department Authorization Scoping...');

    const insightsA = await getDepartmentInsights(approverA as any, {});
    assert(
      insightsA.summary.totalResources === 2,
      'Approver A sees exactly their 2 authorized resources in Dept A'
    );
    assert(
      !insightsA.resourceUtilisation.some((r: any) => r.resourceCode === 'P9_BIO_LAB'),
      'Approver A CANNOT see Dept B resources'
    );

    const insightsB = await getDepartmentInsights(approverB as any, {});
    assert(
      insightsB.summary.totalResources === 1,
      'Approver B sees exactly their 1 authorized resource in Dept B'
    );
    assert(
      insightsB.resourceUtilisation[0].resourceCode === 'P9_BIO_LAB',
      'Approver B sees only Dept B resource'
    );

    // -------------------------------------------------------------------------
    // 3. Testing Mathematical Metric Calculations
    // -------------------------------------------------------------------------
    console.log('\n3. Testing Accurate Metric Calculations...');

    // In Dept A:
    // Total bookings for Dept A in range = 4 (P9-TEST-001, 002, 003, 004)
    assert(insightsA.summary.totalBookings === 4, 'Total bookings count matches (4 bookings)');

    // No-show rate: 2 no-shows out of 4 non-pending bookings = 50%
    assert(insightsA.noShowMetrics.totalNoShows === 2, 'Total no-shows correctly computed as 2');
    assert(insightsA.noShowMetrics.noShowRate === 50, 'No-show rate accurately calculated as 50%');

    // Repeat no-show requesters: studentRepeatNoShow has 2 no-shows
    assert(
      insightsA.noShowMetrics.repeatNoShowRequesters.length === 1,
      'Identified exactly 1 repeat no-show requester (≥ 2 no-shows)'
    );
    assert(
      insightsA.noShowMetrics.repeatNoShowRequesters[0].userId === studentRepeatNoShow.id,
      'Repeat no-show requester matches expected user'
    );

    // Idle Resource detection: P9_IDLE_ROOM had only a rejected booking -> 0 booked hours -> flagged idle
    assert(
      insightsA.idleResources.some((r: any) => r.resourceCode === 'P9_IDLE_ROOM'),
      'P9_IDLE_ROOM correctly flagged as idle resource below threshold'
    );

    // Quota usage by user group
    const facultyQuota = insightsA.quotaUsage.find((q: any) => q.role === 'FACULTY');
    assert(facultyQuota && facultyQuota.totalHours === 4, 'Quota usage: Faculty recorded 4 hours booked');

    const studentQuota = insightsA.quotaUsage.find((q: any) => q.role === 'STUDENT');
    // student had two 2-hour no-show bookings = 4 hours
    assert(studentQuota && studentQuota.totalHours === 4, 'Quota usage: Student recorded 4 hours booked');

    // Approve-to-reject ratio:
    // Dept A bookings: P9-TEST-001 (CHECKED_IN), 002 (NO_SHOW), 003 (NO_SHOW), 004 (REJECTED)
    assert(
      insightsA.decisionMetrics.approveToRejectRatio.approved === 3,
      'Approval metrics count 3 approved/confirmed/attended requests'
    );
    assert(
      insightsA.decisionMetrics.approveToRejectRatio.rejected === 1,
      'Approval metrics count 1 rejected request'
    );

    // -------------------------------------------------------------------------
    // 4. Testing 60-Second Cache Behavior
    // -------------------------------------------------------------------------
    console.log('\n4. Testing 60-Second In-Memory Cache...');

    const cachedRun = await getDepartmentInsights(approverA as any, {});
    assert(cachedRun.cached === true, 'Subsequent call within 60s returns cached result (cached: true)');

    clearInsightsCache();
    const freshRun = await getDepartmentInsights(approverA as any, {});
    assert(freshRun.cached === false, 'Cache clearance results in fresh SQL computation (cached: false)');

    // -------------------------------------------------------------------------
    // 5. Testing Policy-Change Request
    // -------------------------------------------------------------------------
    console.log('\n5. Testing Policy-Change Request Dispatch...');

    const policyReqResult = await sendPolicyChangeRequest(approverA as any, {
      department: deptA.name,
      resourceId: resourceIdle.id,
      subject: 'Reduce approval barrier for P9 Workshop 102',
      details: 'Room has been idle on weekday afternoons with 0% utilisation.',
      suggestedPolicy: 'Permit auto-approval for student self-study.',
    });

    assert(policyReqResult.success === true, 'Policy-change request successfully recorded');

    // Verify Notification sent to Admin
    const adminNotif = await prisma.notification.findFirst({
      where: {
        userId: adminUser.id,
        title: { contains: 'Policy Change Request' },
      },
      orderBy: { createdAt: 'desc' },
    });
    assert(adminNotif !== null, 'Delivered policy-change request notification to ADMINISTRATOR');

    // -------------------------------------------------------------------------
    // 6. Testing Internal Note on Repeat No-Show User & Requester Shielding
    // -------------------------------------------------------------------------
    console.log('\n6. Testing Internal Note on Repeat No-Show Requester...');

    const noteResult = await addNoShowInternalNote(approverA as any, {
      targetUserId: studentRepeatNoShow.id,
      note: 'Student missed 2 consecutive robotics lab sessions without notice.',
    });

    assert(noteResult.success === true, 'Internal note successfully recorded for no-show user');

    // Verify internal note is saved as isInternal: true and shielded from student
    const internalNoteComment = await prisma.bookingComment.findFirst({
      where: {
        authorId: approverA.id,
        isInternal: true,
      },
    });
    assert(internalNoteComment !== null, 'Internal note recorded with isInternal: true on booking');

    // Requester query should NOT return this internal note
    const requesterVisibleComments = await prisma.bookingComment.findMany({
      where: {
        bookingId: internalNoteComment!.bookingId,
        isInternal: false,
      },
    });
    assert(
      !requesterVisibleComments.some((c) => c.body.includes('[APPROVER INTERNAL NOTE ON REPEAT NO-SHOW]')),
      'Internal warning note strictly omitted from requester visible comment queries'
    );

    const auditLogNote = await prisma.auditLog.findFirst({
      where: {
        action: 'NO_SHOW_NOTE_RECORDED',
        entityId: studentRepeatNoShow.id,
      },
    });
    assert(auditLogNote !== null, 'Logged NO_SHOW_NOTE_RECORDED in system AuditLog');

    // Clean up test bookings
    await prisma.booking.deleteMany({
      where: { bookingNumber: { startsWith: 'P9-TEST-' } },
    });

    console.log('\n======================================================');
    console.log(`P9 TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error in P9 test suite:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runP9Tests();
