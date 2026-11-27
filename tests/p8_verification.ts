import { prisma } from '../apps/backend/src/lib/prisma';
import {
  BookingStatus,
  Role,
  ResourceCategory,
  PriorityLevel,
  ActivityType,
} from '@prisma/client';
import {
  addBookingComment,
  getBookingComments,
  getBookingHistory,
  sanitizeComment,
} from '../apps/backend/src/services/commentHistory.service';
import { processApprovalAction } from '../apps/backend/src/services/approvalService';

async function runP8Tests() {
  console.log('--- STARTING P8 COMMENTS & DECISION HISTORY TEST SUITE ---');
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
    console.log('\n1. Setting up P8 Fixtures...');
    const testDept = await prisma.department.upsert({
      where: { code: 'P8_DEPT' },
      update: {},
      create: { code: 'P8_DEPT', name: 'P8 Department of Media' },
    });

    const foreignDept = await prisma.department.upsert({
      where: { code: 'P8_FOREIGN' },
      update: {},
      create: { code: 'P8_FOREIGN', name: 'P8 Foreign Department' },
    });

    // Department policy with 12-hour SLA
    await prisma.departmentPolicy.upsert({
      where: { department: testDept.name },
      update: { approvalSlaHours: 12 },
      create: {
        department: testDept.name,
        departmentId: testDept.id,
        approvalSlaHours: 12,
      },
    });

    const studentRequester = await prisma.user.upsert({
      where: { email: 'p8_student@lpu.in' },
      update: { isAway: false },
      create: {
        email: 'p8_student@lpu.in',
        name: 'P8 Student Requester',
        passwordHash: 'dummy',
        role: Role.STUDENT,
        department: testDept.name,
        departmentId: testDept.id,
      },
    });

    const otherStudent = await prisma.user.upsert({
      where: { email: 'p8_other_student@lpu.in' },
      update: {},
      create: {
        email: 'p8_other_student@lpu.in',
        name: 'P8 Other Student',
        passwordHash: 'dummy',
        role: Role.STUDENT,
        department: testDept.name,
        departmentId: testDept.id,
      },
    });

    const approver = await prisma.user.upsert({
      where: { email: 'p8_approver@lpu.in' },
      update: { isAway: false },
      create: {
        email: 'p8_approver@lpu.in',
        name: 'P8 Prof Approver',
        passwordHash: 'dummy',
        role: Role.DEPARTMENT_APPROVER,
        department: testDept.name,
        departmentId: testDept.id,
      },
    });

    const foreignApprover = await prisma.user.upsert({
      where: { email: 'p8_foreign_approver@lpu.in' },
      update: { isAway: false },
      create: {
        email: 'p8_foreign_approver@lpu.in',
        name: 'P8 Foreign Approver',
        passwordHash: 'dummy',
        role: Role.DEPARTMENT_APPROVER,
        department: foreignDept.name,
        departmentId: foreignDept.id,
      },
    });

    // Assign approver to testDept
    await prisma.approverAssignment.upsert({
      where: {
        userId_departmentId: {
          userId: approver.id,
          departmentId: testDept.id,
        },
      },
      update: {},
      create: {
        userId: approver.id,
        departmentId: testDept.id,
        isPrimary: true,
      },
    });

    // Assign foreignApprover only to foreignDept
    await prisma.approverAssignment.upsert({
      where: {
        userId_departmentId: {
          userId: foreignApprover.id,
          departmentId: foreignDept.id,
        },
      },
      update: {},
      create: {
        userId: foreignApprover.id,
        departmentId: foreignDept.id,
        isPrimary: true,
      },
    });

    const resource = await prisma.resource.upsert({
      where: { code: 'P8_STUDIO_01' },
      update: {},
      create: {
        code: 'P8_STUDIO_01',
        name: 'P8 Studio Hall',
        category: ResourceCategory.SEMINAR_HALL,
        department: testDept.name,
        departmentId: testDept.id,
        building: 'Block P8',
        requiresApproval: true,
        imageUrl: 'http://example.com/p8.jpg',
      },
    });

    // Clean up test bookings
    await prisma.booking.deleteMany({
      where: { bookingNumber: { startsWith: 'P8-TEST-' } },
    });

    const now = new Date();
    const testBooking = await prisma.booking.create({
      data: {
        bookingNumber: 'P8-TEST-001',
        userId: studentRequester.id,
        resourceId: resource.id,
        departmentId: testDept.id,
        startTime: new Date(now.getTime() + 86400000),
        endTime: new Date(now.getTime() + 90000000),
        purpose: 'Media Presentation',
        activityType: ActivityType.PROJECT_WORK,
        status: BookingStatus.PENDING,
        slaDueAt: new Date(now.getTime() + 12 * 3600000),
      },
    });

    // -------------------------------------------------------------------------
    // 2. Testing Comment Sanitization and Validation
    // -------------------------------------------------------------------------
    console.log('\n2. Testing Comment Sanitization & Validation...');

    const xssInput = 'Hello <script>alert("hack")</script><b>world</b>!';
    const sanitized = sanitizeComment(xssInput);
    assert(!sanitized.includes('<script>') && !sanitized.includes('<b>'), 'Script and HTML tags sanitized from comment');
    assert(sanitized.includes('Hello') && sanitized.includes('world!'), 'Sanitization preserves text content');

    // Validation: Empty comment rejected
    try {
      await addBookingComment(testBooking.id, studentRequester as any, '   ');
      assert(false, 'Should reject empty comment');
    } catch (e: any) {
      assert(e.statusCode === 400, 'Rejects empty comment with 400 error');
    }

    // Validation: Excessive length rejected (>2000 chars)
    try {
      await addBookingComment(testBooking.id, studentRequester as any, 'a'.repeat(2001));
      assert(false, 'Should reject comment exceeding 2000 characters');
    } catch (e: any) {
      assert(e.statusCode === 400, 'Rejects >2000 character comment with 400 error');
    }

    // -------------------------------------------------------------------------
    // 3. Testing Internal Notes Security & Access Control
    // -------------------------------------------------------------------------
    console.log('\n3. Testing Internal Notes Security...');

    // Approver posts an internal note
    await addBookingComment(
      testBooking.id,
      approver as any,
      'Internal note: Requester has previous no-shows, verify equipment safety.',
      true // isInternal = true
    );

    // Approver posts a public comment
    await addBookingComment(
      testBooking.id,
      approver as any,
      'Public comment: Please confirm attendance count.',
      false // isInternal = false
    );

    // Approver retrieves comments -> should see BOTH public and internal
    const approverComments = await getBookingComments(testBooking.id, approver as any);
    assert(approverComments.length === 2, 'Approver sees all comments (public + internal)');
    assert(approverComments.some((c) => c.isInternal), 'Approver can see internal notes');

    // Student Requester retrieves comments -> MUST NEVER see internal note
    const studentComments = await getBookingComments(testBooking.id, studentRequester as any);
    assert(studentComments.length === 1, 'Requester sees only public comments');
    assert(!studentComments.some((c) => c.isInternal), 'Internal notes strictly hidden from requester');

    // Requester attempts to post an internal note -> forced to isInternal: false
    const requesterNote = await addBookingComment(
      testBooking.id,
      studentRequester as any,
      'I want this to be internal',
      true // requester attempts isInternal
    );
    assert(requesterNote.comment.isInternal === false, 'Requesters cannot set isInternal: true (forced false)');

    // -------------------------------------------------------------------------
    // 4. Testing Department Authorization Boundary
    // -------------------------------------------------------------------------
    console.log('\n4. Testing Department Authorization Boundary...');

    // Foreign approver (from P8_FOREIGN) tries to view comments of P8_DEPT booking -> 403 Forbidden
    try {
      await getBookingComments(testBooking.id, foreignApprover as any);
      assert(false, 'Unauthorized foreign approver should not access comments');
    } catch (e: any) {
      assert(e.statusCode === 403, 'Foreign approver blocked from viewing comments with 403');
    }

    // Unrelated student tries to view comments -> 403 Forbidden
    try {
      await getBookingComments(testBooking.id, otherStudent as any);
      assert(false, 'Unrelated student should not access comments');
    } catch (e: any) {
      assert(e.statusCode === 403, 'Unrelated student blocked with 403');
    }

    // -------------------------------------------------------------------------
    // 5. Testing REQUEST_INFO Workflow & SLA Restart
    // -------------------------------------------------------------------------
    console.log('\n5. Testing REQUEST_INFO & SLA Restart...');

    // 5a. Approver executes REQUEST_INFO
    await processApprovalAction({
      bookingId: testBooking.id,
      approver: approver as any,
      action: 'REQUEST_INFO',
      question: 'Will there be faculty supervision for the camera gear?',
    });

    const bookingAfterRequestInfo = await prisma.booking.findUnique({
      where: { id: testBooking.id },
    });
    assert(bookingAfterRequestInfo?.status === BookingStatus.NEEDS_INFO, 'Booking transitioned to NEEDS_INFO');

    // 5b. Requester replies to the question via addBookingComment
    const replyResult = await addBookingComment(
      testBooking.id,
      studentRequester as any,
      'Yes, Dr. Sharma will be supervising the session in person.'
    );

    assert(replyResult.statusChangedToPending === true, 'Replying to NEEDS_INFO returned statusChangedToPending: true');
    assert(replyResult.restartedSlaDueAt !== null, 'SLA clock due date restarted');

    const freshBooking = await prisma.booking.findUnique({
      where: { id: testBooking.id },
    });
    assert(freshBooking?.status === BookingStatus.PENDING, 'Booking is now back in PENDING status');
    assert(freshBooking?.slaDueAt !== null && freshBooking!.slaDueAt > now, 'SLA clock restarted with future deadline');

    // -------------------------------------------------------------------------
    // 6. Testing Unified Decision & Audit History Timeline
    // -------------------------------------------------------------------------
    console.log('\n6. Testing Decision & Audit History Timeline...');

    const historyData = await getBookingHistory(testBooking.id, studentRequester as any);
    assert(historyData.timeline.length >= 2, 'History timeline contains multiple audit and decision events');

    const actions = historyData.timeline.map((item) => item.action);
    assert(actions.includes('REQUEST_INFO'), 'Timeline includes REQUEST_INFO decision');
    assert(actions.includes('INFO_PROVIDED'), 'Timeline includes INFO_PROVIDED decision');
    assert(actions.includes('BOOKING_INFO_SUBMITTED'), 'Timeline includes BOOKING_INFO_SUBMITTED audit event');

    // Verify requester history does not leak internal note audit logs
    const hasInternalAuditInRequesterView = historyData.timeline.some(
      (item) => item.action === 'INTERNAL_NOTE_ADDED' || item.details?.includes('internal note')
    );
    assert(!hasInternalAuditInRequesterView, 'Internal note audit details omitted from requester history view');

    // Clean up test bookings
    await prisma.booking.deleteMany({
      where: { bookingNumber: { startsWith: 'P8-TEST-' } },
    });

    console.log('\n======================================================');
    console.log(`P8 TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error in P8 test suite:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runP8Tests();
