import { prisma } from '../apps/backend/src/lib/prisma';
import {
  calculatePriorityScore,
  compareBookingPriority,
  getPreemptionCandidates,
  executePreemption,
  confirmFacultyPreemptionByAdmin,
  undoPreemption,
} from '../apps/backend/src/services/preemption.service';
import {
  BookingStatus,
  Role,
  ResourceCategory,
  PriorityLevel,
  ActivityType,
  PreemptionStatus,
} from '@prisma/client';

async function runP6Tests() {
  console.log('--- STARTING P6 PRIORITY & CONTROLLED PRE-EMPTION TEST SUITE ---');
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
    // TEST 1: Centralized Priority Rules & Ordering
    // -------------------------------------------------------------------------
    console.log('\n1. Testing Centralized Priority Ordering Rules...');
    // 1a. URGENT and HIGH requests sort before normal requests
    const normalScore = calculatePriorityScore({
      priority: PriorityLevel.NORMAL,
      activityType: ActivityType.PROJECT_WORK,
      userRole: Role.STUDENT,
    });
    const highScore = calculatePriorityScore({
      priority: PriorityLevel.HIGH,
      activityType: ActivityType.PROJECT_WORK,
      userRole: Role.STUDENT,
    });
    const urgentScore = calculatePriorityScore({
      priority: PriorityLevel.URGENT,
      activityType: ActivityType.PROJECT_WORK,
      userRole: Role.STUDENT,
    });

    assert(urgentScore > highScore, 'URGENT priority score > HIGH priority score');
    assert(highScore > normalScore, 'HIGH priority score > NORMAL priority score');

    // 1b. Faculty events outrank student club events
    const studentClubScore = calculatePriorityScore({
      priority: PriorityLevel.NORMAL,
      activityType: ActivityType.CLUB_EVENT,
      userRole: Role.STUDENT,
    });
    const facultyEventScore = calculatePriorityScore({
      priority: PriorityLevel.NORMAL,
      activityType: ActivityType.FACULTY_MEETING,
      userRole: Role.FACULTY,
    });
    assert(facultyEventScore > studentClubScore, 'Faculty meeting outranks Student Club event');

    // 1c. Exam/evaluation activities outrank all normal bookings
    const examScore = calculatePriorityScore({
      priority: PriorityLevel.NORMAL,
      activityType: ActivityType.EXAM_EVALUATION,
      userRole: Role.FACULTY,
    });
    const urgentStudentScore = calculatePriorityScore({
      priority: PriorityLevel.URGENT,
      activityType: ActivityType.PROJECT_WORK,
      userRole: Role.STUDENT,
    });
    assert(examScore > urgentStudentScore, 'EXAM_EVALUATION outranks normal URGENT bookings');

    // -------------------------------------------------------------------------
    // Set up Database Fixtures
    // -------------------------------------------------------------------------
    console.log('\n2. Setting up P6 Database Fixtures...');
    const testDept = await prisma.department.upsert({
      where: { code: 'P6_DEPT' },
      update: {},
      create: { code: 'P6_DEPT', name: 'P6 Computer Science' },
    });

    const foreignDept = await prisma.department.upsert({
      where: { code: 'P6_FOREIGN' },
      update: {},
      create: { code: 'P6_FOREIGN', name: 'P6 Electrical Eng' },
    });

    const approverUser = await prisma.user.upsert({
      where: { email: 'approver_p6@test.lpu.in' },
      update: {},
      create: {
        email: 'approver_p6@test.lpu.in',
        name: 'Dr. Approver P6',
        role: Role.DEPARTMENT_APPROVER,
        passwordHash: 'dummyhash',
        department: testDept.name,
        departmentId: testDept.id,
      },
    });

    await prisma.approverAssignment.upsert({
      where: {
        userId_departmentId: { userId: approverUser.id, departmentId: testDept.id },
      },
      update: {},
      create: { userId: approverUser.id, departmentId: testDept.id, isPrimary: true },
    });

    const adminUser = await prisma.user.upsert({
      where: { email: 'admin_p6@test.lpu.in' },
      update: {},
      create: {
        email: 'admin_p6@test.lpu.in',
        name: 'Dean Administrator P6',
        role: Role.ADMINISTRATOR,
        passwordHash: 'dummyhash',
        department: 'University Administration',
      },
    });

    const studentUser = await prisma.user.upsert({
      where: { email: 'student_p6@test.lpu.in' },
      update: {},
      create: {
        email: 'student_p6@test.lpu.in',
        name: 'Student Club Lead P6',
        role: Role.STUDENT,
        passwordHash: 'dummyhash',
        department: testDept.name,
      },
    });

    const facultyUser = await prisma.user.upsert({
      where: { email: 'faculty_p6@test.lpu.in' },
      update: {},
      create: {
        email: 'faculty_p6@test.lpu.in',
        name: 'Prof. Faculty P6',
        role: Role.FACULTY,
        passwordHash: 'dummyhash',
        department: testDept.name,
      },
    });

    const resourceRoom = await prisma.resource.upsert({
      where: { code: 'P6_AUDITORIUM' },
      update: { isUnderMaintenance: false },
      create: {
        code: 'P6_AUDITORIUM',
        name: 'P6 Main Auditorium Hall',
        category: ResourceCategory.SEMINAR_HALL,
        department: testDept.name,
        departmentId: testDept.id,
        building: 'Block 32',
        capacity: 100,
        imageUrl: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4',
        operatingHours: '08:00 AM - 08:00 PM',
        requiresApproval: true,
      },
    });

    const timeStart = new Date();
    timeStart.setDate(timeStart.getDate() + 2);
    timeStart.setHours(14, 0, 0, 0);
    const timeEnd = new Date(timeStart);
    timeEnd.setHours(16, 0, 0, 0);

    // Clean prior bookings
    await prisma.preemptionRecord.deleteMany({
      where: {
        targetBooking: { bookingNumber: { in: ['P6-URG-01', 'P6-URG-02', 'P6-URG-03'] } },
      },
    });
    await prisma.waitlistEntry.deleteMany({
      where: {
        booking: { bookingNumber: { in: ['P6-STU-01', 'P6-FAC-01', 'P6-CHK-01'] } },
      },
    });
    await prisma.booking.deleteMany({
      where: {
        bookingNumber: { in: ['P6-STU-01', 'P6-FAC-01', 'P6-CHK-01', 'P6-URG-01', 'P6-URG-02', 'P6-URG-03'] },
      },
    });

    // -------------------------------------------------------------------------
    // TEST 2: Pre-emption of Lower-Priority Confirmed Student Booking
    // -------------------------------------------------------------------------
    console.log('\n3. Testing Pre-emption of Confirmed Student Booking...');
    const studentBooking = await prisma.booking.create({
      data: {
        bookingNumber: 'P6-STU-01',
        userId: studentUser.id,
        resourceId: resourceRoom.id,
        departmentId: testDept.id,
        startTime: timeStart,
        endTime: timeEnd,
        purpose: 'Robotics Club Showcase',
        activityType: ActivityType.CLUB_EVENT,
        priority: PriorityLevel.NORMAL,
        status: BookingStatus.CONFIRMED,
        checkInToken: '111222',
      },
    });

    const urgentExamBooking = await prisma.booking.create({
      data: {
        bookingNumber: 'P6-URG-01',
        userId: facultyUser.id,
        resourceId: resourceRoom.id,
        departmentId: testDept.id,
        startTime: timeStart,
        endTime: timeEnd,
        purpose: 'University Semester Final Lab Examination',
        activityType: ActivityType.EXAM_EVALUATION,
        priority: PriorityLevel.URGENT,
        status: BookingStatus.PENDING,
      },
    });

    // Test Candidate Query
    const candResult = await getPreemptionCandidates(urgentExamBooking.id, approverUser as any);
    assert(candResult.candidates.length === 1, 'Identified 1 overlapping confirmed booking');
    assert(candResult.candidates[0].qualifies === true, 'Student booking qualifies for pre-emption');
    assert(
      candResult.candidates[0].requiresAdminConfirmation === false,
      'Student booking does not require admin confirmation'
    );

    // Execute Pre-emption
    const preemptRes = await executePreemption({
      urgentBookingId: urgentExamBooking.id,
      bumpedBookingId: studentBooking.id,
      approver: approverUser as any,
      reason: 'Mandatory University Semester Examination scheduling',
    });

    assert(
      preemptRes.status === PreemptionStatus.COMPLETED,
      'Pre-emption completed immediately for student booking'
    );

    // Verify Urgent is CONFIRMED, Student is CANCELLED
    const refreshedUrgent = await prisma.booking.findUnique({ where: { id: urgentExamBooking.id } });
    const refreshedStudent = await prisma.booking.findUnique({ where: { id: studentBooking.id } });
    assert(refreshedUrgent?.status === BookingStatus.CONFIRMED, 'Urgent exam booking is now CONFIRMED');
    assert(refreshedStudent?.status === BookingStatus.CANCELLED, 'Bumped student booking is CANCELLED');

    // Verify Waitlist entry created with priority 100
    const waitlist = await prisma.waitlistEntry.findFirst({
      where: { bookingId: studentBooking.id },
    });
    assert(waitlist !== null && waitlist.priority === 100, 'Bumped user placed #1 on waitlist (priority: 100)');

    // Verify Notifications sent to bumped student
    const notif = await prisma.notification.findFirst({
      where: { userId: studentUser.id, title: { contains: 'Pre-empted' } },
    });
    assert(notif !== null, 'Sent notification to bumped user with pre-emption reason');

    // -------------------------------------------------------------------------
    // TEST 3: 5-Minute Undo Window Safety & Exclusion Constraint Compliance
    // -------------------------------------------------------------------------
    console.log('\n4. Testing 5-Minute Undo Window & Exclusion Constraint...');
    const recordId = preemptRes.preemptionRecord.id;

    // Verify database state before undo: Urgent is CONFIRMED, Student is CANCELLED
    const preUndoUrgent = await prisma.booking.findUnique({ where: { id: urgentExamBooking.id } });
    const preUndoStudent = await prisma.booking.findUnique({ where: { id: studentBooking.id } });
    assert(preUndoUrgent?.status === BookingStatus.CONFIRMED, 'Pre-undo state: urgent booking is CONFIRMED');
    assert(preUndoStudent?.status === BookingStatus.CANCELLED, 'Pre-undo state: bumped student booking is CANCELLED');

    const undoRes = await undoPreemption(
      recordId,
      approverUser as any,
      'Administrative mistake: exam was rescheduled to next week'
    );
    assert(undoRes.status === PreemptionStatus.UNDONE, 'Successfully undid pre-emption without exclusion constraint conflict');

    const restoredStudent = await prisma.booking.findUnique({ where: { id: studentBooking.id } });
    const revertedUrgent = await prisma.booking.findUnique({ where: { id: urgentExamBooking.id } });
    assert(revertedUrgent?.status === BookingStatus.PENDING, 'Urgent booking returned to PENDING first');
    assert(restoredStudent?.status === BookingStatus.CONFIRMED, 'Bumped student booking restored to CONFIRMED');
    assert(restoredStudent?.checkInToken === '111222', 'Bumped student booking restored original check-in token');

    const postUndoWaitlist = await prisma.waitlistEntry.findFirst({
      where: { bookingId: studentBooking.id },
    });
    assert(postUndoWaitlist === null, 'Bumped student waitlist entry successfully removed upon undo');

    // -------------------------------------------------------------------------
    // TEST 4: CHECKED_IN Protection (Never Pre-empt Checked-In)
    // -------------------------------------------------------------------------
    console.log('\n5. Testing Strict Protection for CHECKED_IN Bookings...');
    // Mark student booking as CHECKED_IN
    await prisma.booking.update({
      where: { id: studentBooking.id },
      data: { status: BookingStatus.CHECKED_IN, checkedInAt: new Date() },
    });

    let checkedInBlocked = false;
    try {
      await executePreemption({
        urgentBookingId: urgentExamBooking.id,
        bumpedBookingId: studentBooking.id,
        approver: approverUser as any,
        reason: 'Attempting to bump checked-in session',
      });
    } catch (err: any) {
      if (err.statusCode === 400 && err.message.includes('CHECKED_IN')) {
        checkedInBlocked = true;
      }
    }
    assert(checkedInBlocked, 'Strictly blocked pre-emption of CHECKED_IN booking');

    // -------------------------------------------------------------------------
    // TEST 5: Faculty Protection & Administrator Second Confirmation
    // -------------------------------------------------------------------------
    console.log('\n6. Testing Faculty Protection Protocol...');
    const facultyBooking = await prisma.booking.create({
      data: {
        bookingNumber: 'P6-FAC-01',
        userId: facultyUser.id,
        resourceId: resourceRoom.id,
        departmentId: testDept.id,
        startTime: new Date(timeStart.getTime() + 24 * 3600000), // Next day
        endTime: new Date(timeEnd.getTime() + 24 * 3600000),
        purpose: 'Faculty Research Syndicate Seminar',
        activityType: ActivityType.FACULTY_MEETING,
        priority: PriorityLevel.NORMAL,
        status: BookingStatus.CONFIRMED,
        checkInToken: '333444',
      },
    });

    const urgentExam2 = await prisma.booking.create({
      data: {
        bookingNumber: 'P6-URG-02',
        userId: approverUser.id,
        resourceId: resourceRoom.id,
        departmentId: testDept.id,
        startTime: facultyBooking.startTime,
        endTime: facultyBooking.endTime,
        purpose: 'State Accreditation Board Evaluation',
        activityType: ActivityType.EXAM_EVALUATION,
        priority: PriorityLevel.URGENT,
        status: BookingStatus.PENDING,
      },
    });

    // Approver requests pre-emption on faculty booking
    const facultyPreemptRes = await executePreemption({
      urgentBookingId: urgentExam2.id,
      bumpedBookingId: facultyBooking.id,
      approver: approverUser as any,
      reason: 'State Accreditation Committee mandatory visit',
    });

    assert(
      facultyPreemptRes.status === PreemptionStatus.PENDING_ADMIN_CONFIRMATION,
      'Faculty pre-emption held in PENDING_ADMIN_CONFIRMATION'
    );
    assert(
      facultyPreemptRes.requiresAdminConfirmation === true,
      'Requires explicit Administrator confirmation'
    );

    // Target bookings remain uncancelled until Administrator confirms
    const facultyCheck = await prisma.booking.findUnique({ where: { id: facultyBooking.id } });
    assert(facultyCheck?.status === BookingStatus.CONFIRMED, 'Faculty booking remains CONFIRMED while pending admin');

    // Administrator confirms pre-emption
    const adminConfirmRes = await confirmFacultyPreemptionByAdmin(
      facultyPreemptRes.preemptionRecord.id,
      adminUser as any,
      true,
      'Accreditation visit verified and approved by Dean'
    );
    assert(adminConfirmRes.status === PreemptionStatus.COMPLETED, 'Admin confirmation completed pre-emption');

    const finalFaculty = await prisma.booking.findUnique({ where: { id: facultyBooking.id } });
    const finalUrgent = await prisma.booking.findUnique({ where: { id: urgentExam2.id } });
    assert(finalFaculty?.status === BookingStatus.CANCELLED, 'Faculty booking now CANCELLED upon admin confirmation');
    assert(finalUrgent?.status === BookingStatus.CONFIRMED, 'Urgent booking now CONFIRMED upon admin confirmation');

    // -------------------------------------------------------------------------
    // TEST 6: Department Isolation Enforcement
    // -------------------------------------------------------------------------
    console.log('\n7. Testing Department Isolation on Pre-emption...');
    const foreignBooking = await prisma.booking.create({
      data: {
        bookingNumber: 'P6-URG-03',
        userId: studentUser.id,
        resourceId: resourceRoom.id,
        departmentId: foreignDept.id, // Foreign!
        startTime: finalFaculty.startTime,
        endTime: finalFaculty.endTime,
        purpose: 'Unauthorized departmental request',
        activityType: ActivityType.PROJECT_WORK,
        priority: PriorityLevel.URGENT,
        status: BookingStatus.PENDING,
      },
    });

    let isolationBlocked = false;
    try {
      await executePreemption({
        urgentBookingId: foreignBooking.id,
        bumpedBookingId: studentBooking.id,
        approver: approverUser as any,
        reason: 'Attempting cross-department pre-emption without rights',
      });
    } catch (err: any) {
      if (err.statusCode === 403) {
        isolationBlocked = true;
      }
    }
    assert(isolationBlocked, 'Blocked pre-emption across unauthorized department boundary (403)');

    // Clean up test bookings
    await prisma.preemptionRecord.deleteMany({
      where: {
        targetBooking: { bookingNumber: { in: ['P6-URG-01', 'P6-URG-02', 'P6-URG-03'] } },
      },
    });
    await prisma.waitlistEntry.deleteMany({
      where: {
        booking: { bookingNumber: { in: ['P6-STU-01', 'P6-FAC-01', 'P6-CHK-01'] } },
      },
    });
    await prisma.booking.deleteMany({
      where: {
        bookingNumber: { in: ['P6-STU-01', 'P6-FAC-01', 'P6-CHK-01', 'P6-URG-01', 'P6-URG-02', 'P6-URG-03'] },
      },
    });

    console.log(`\n======================================================`);
    console.log(`P6 TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log(`======================================================`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error in P6 test suite:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runP6Tests();
