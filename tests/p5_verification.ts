import { prisma } from '../apps/backend/src/lib/prisma';
import {
  getCompetingBookings,
  suggestAlternativeRooms,
  suggestAlternativeTimes,
  getAlternativeSuggestions,
} from '../apps/backend/src/services/alternativeSuggestion.service';
import { processApprovalAction } from '../apps/backend/src/services/approvalService';
import { BookingStatus, Role, ResourceCategory, PriorityLevel } from '@prisma/client';

async function runP5Tests() {
  console.log('--- STARTING P5 VERIFICATION SUITE ---');
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
    // 1. Setup Test Fixtures: Department, Approver, Users, Resources
    console.log('\n1. Setting up test fixtures...');
    const testDept = await prisma.department.upsert({
      where: { code: 'P5_DEPT' },
      update: {},
      create: {
        code: 'P5_DEPT',
        name: 'P5 Computer Science & Tech',
      },
    });

    const foreignDept = await prisma.department.upsert({
      where: { code: 'P5_FOREIGN' },
      update: {},
      create: {
        code: 'P5_FOREIGN',
        name: 'P5 Mechanical Engineering',
      },
    });

    const approverUser = await prisma.user.upsert({
      where: { email: 'approver_p5@test.lpu.in' },
      update: {},
      create: {
        email: 'approver_p5@test.lpu.in',
        name: 'Dr. Approver P5',
        role: Role.DEPARTMENT_APPROVER,
        passwordHash: 'dummyhash',
        department: testDept.name,
        departmentId: testDept.id,
      },
    });

    // Ensure ApproverAssignment
    await prisma.approverAssignment.upsert({
      where: {
        userId_departmentId: {
          userId: approverUser.id,
          departmentId: testDept.id,
        },
      },
      update: {},
      create: {
        userId: approverUser.id,
        departmentId: testDept.id,
        isPrimary: true,
      },
    });

    const requesterUser1 = await prisma.user.upsert({
      where: { email: 'student1_p5@test.lpu.in' },
      update: {},
      create: {
        email: 'student1_p5@test.lpu.in',
        name: 'Student One P5',
        role: Role.STUDENT,
        passwordHash: 'dummyhash',
        department: testDept.name,
      },
    });

    const requesterUser2 = await prisma.user.upsert({
      where: { email: 'student2_p5@test.lpu.in' },
      update: {},
      create: {
        email: 'student2_p5@test.lpu.in',
        name: 'Student Two P5',
        role: Role.STUDENT,
        passwordHash: 'dummyhash',
        department: testDept.name,
      },
    });

    // Resources:
    // Room A (Primary): Cap 40, Block 34
    const roomA = await prisma.resource.upsert({
      where: { code: 'P5_ROOM_A' },
      update: { isUnderMaintenance: false },
      create: {
        code: 'P5_ROOM_A',
        name: 'P5 Lab Room A',
        category: ResourceCategory.LAB,
        department: testDept.name,
        departmentId: testDept.id,
        building: 'Block 34',
        floor: '2',
        capacity: 40,
        imageUrl: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4',
        operatingHours: '08:00 AM - 08:00 PM',
        requiresApproval: true,
      },
    });

    // Room B (Alternative): Cap 45, Block 34 (Same building, close capacity)
    const roomB = await prisma.resource.upsert({
      where: { code: 'P5_ROOM_B' },
      update: { isUnderMaintenance: false },
      create: {
        code: 'P5_ROOM_B',
        name: 'P5 Lab Room B (Same Building)',
        category: ResourceCategory.LAB,
        department: testDept.name,
        departmentId: testDept.id,
        building: 'Block 34',
        floor: '2',
        capacity: 45,
        imageUrl: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4',
        operatingHours: '08:00 AM - 08:00 PM',
        requiresApproval: true,
      },
    });

    // Room C (Alternative): Cap 80, Block 38 (Different building, higher capacity)
    const roomC = await prisma.resource.upsert({
      where: { code: 'P5_ROOM_C' },
      update: { isUnderMaintenance: false },
      create: {
        code: 'P5_ROOM_C',
        name: 'P5 Lab Room C (Diff Building)',
        category: ResourceCategory.LAB,
        department: testDept.name,
        departmentId: testDept.id,
        building: 'Block 38',
        floor: '1',
        capacity: 80,
        imageUrl: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4',
        operatingHours: '08:00 AM - 08:00 PM',
        requiresApproval: true,
      },
    });

    // Room D (Foreign Dept): Cap 50 (Approver lacks access)
    const roomD = await prisma.resource.upsert({
      where: { code: 'P5_ROOM_D' },
      update: { isUnderMaintenance: false },
      create: {
        code: 'P5_ROOM_D',
        name: 'P5 Mechanical Hall',
        category: ResourceCategory.LAB,
        department: foreignDept.name,
        departmentId: foreignDept.id,
        building: 'Block 25',
        floor: '1',
        capacity: 50,
        imageUrl: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4',
        operatingHours: '08:00 AM - 08:00 PM',
        requiresApproval: true,
      },
    });

    // Setup Target Window: Tomorrow 10:00 AM to 12:00 PM
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(12, 0, 0, 0);

    // Clean any prior bookings for these rooms
    await prisma.booking.deleteMany({
      where: {
        bookingNumber: { in: ['P5-BK-001', 'P5-BK-002', 'P5-BK-003'] },
      },
    });

    // Create Booking 1 (Pending on Room A)
    const booking1 = await prisma.booking.create({
      data: {
        bookingNumber: 'P5-BK-001',
        userId: requesterUser1.id,
        resourceId: roomA.id,
        departmentId: testDept.id,
        startTime: tomorrow,
        endTime: tomorrowEnd,
        purpose: 'AI & Robotics Hands-on Lab Workshop',
        expectedAttendance: 35,
        priority: PriorityLevel.HIGH,
        status: BookingStatus.PENDING,
      },
    });

    // Create Booking 2 (Overlapping Pending on Room A - Competing)
    const booking2 = await prisma.booking.create({
      data: {
        bookingNumber: 'P5-BK-002',
        userId: requesterUser2.id,
        resourceId: roomA.id,
        departmentId: testDept.id,
        startTime: new Date(tomorrow.getTime() + 30 * 60000), // 10:30 - 11:30
        endTime: new Date(tomorrow.getTime() + 90 * 60000),
        purpose: 'Data Structures Code-a-thon',
        expectedAttendance: 30,
        priority: PriorityLevel.NORMAL,
        status: BookingStatus.PENDING,
      },
    });

    // Approver context
    const approverContext = {
      id: approverUser.id,
      email: approverUser.email,
      name: approverUser.name,
      role: approverUser.role,
      department: approverUser.department,
    };

    // -------------------------------------------------------------------------
    // TEST 1: Detect Competing Requests
    // -------------------------------------------------------------------------
    console.log('\n2. Testing Competing Requests Detection...');
    const competingResult = await getCompetingBookings(booking1.id, approverContext as any);
    assert(
      competingResult.competingBookings.length === 1 &&
        competingResult.competingBookings[0].bookingNumber === 'P5-BK-002',
      'Detects overlapping PENDING booking on Room A',
      `Found ${competingResult.competingBookings.length} competing bookings`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Alternative Room Suggestions & Suitability Ranking
    // -------------------------------------------------------------------------
    console.log('\n3. Testing Alternative Room Suggestions & Ranking...');
    const suggestionsResult = await getAlternativeSuggestions(booking1.id, approverContext as any);
    assert(suggestionsResult.hasCompeting === true, 'Flags hasCompeting as true');
    assert(suggestionsResult.competingCount === 1, 'competingCount equals 1');

    const rooms = suggestionsResult.alternativeRooms;
    assert(rooms.length >= 2, 'Suggests at least 2 alternative rooms');

    // Room B (Same building, capacity 45 vs 35) must rank higher than Room C (Diff building, capacity 80)
    assert(
      rooms[0].resourceId === roomB.id,
      'Room B (same building, closest capacity) is ranked #1',
      `Top ranked was ${rooms[0]?.name}`
    );
    assert(
      rooms[0].reasons.some((r) => r.includes('Same building')),
      'Top suggestion includes "Same building" reason'
    );

    // Room D (Foreign department) must NOT be suggested to this approver
    const hasForeignRoom = rooms.some((r) => r.resourceId === roomD.id);
    assert(!hasForeignRoom, 'Department isolation prevents suggesting Room D (Mechanical Eng)');

    // -------------------------------------------------------------------------
    // TEST 3: Alternative Time Slots Suggestions
    // -------------------------------------------------------------------------
    console.log('\n4. Testing Alternative Time Slots Suggestions...');
    const times = suggestionsResult.alternativeTimes;
    assert(times.length > 0, 'Suggests available alternative time slots');
    assert(
      times.every((t) => t.durationMinutes === 120 && t.isAvailable === true),
      'All suggested time slots match the 120-minute duration and are available'
    );

    // -------------------------------------------------------------------------
    // TEST 4: Backend Re-validation on MODIFY
    // -------------------------------------------------------------------------
    console.log('\n5. Testing Backend Revalidation on MODIFY Workflow...');
    // Approve Booking 1 on Room A first
    const approveRes = await processApprovalAction({
      bookingId: booking1.id,
      approver: approverContext as any,
      action: 'APPROVE',
      notes: 'Approved primary request',
    });
    assert(approveRes.booking.status === BookingStatus.CONFIRMED, 'Booking 1 confirmed on Room A');

    // Now Booking 2 tries to be modified into Room B (valid)
    const modifyRes = await processApprovalAction({
      bookingId: booking2.id,
      approver: approverContext as any,
      action: 'MODIFY',
      alternateResourceId: roomB.id,
      newStartTime: tomorrow,
      newEndTime: tomorrowEnd,
      notes: 'Reassigned to Room B to resolve slot contention with Booking 1',
    });
    assert(
      modifyRes.booking.status === BookingStatus.CONFIRMED &&
        modifyRes.booking.resourceId === roomB.id,
      'Successfully modifies Booking 2 into Room B',
      `Assigned resource: ${modifyRes.booking.resourceId}`
    );

    // Verify Audit Decision entry created
    const decisionLog = await prisma.approvalDecision.findFirst({
      where: { bookingId: booking2.id, action: 'MODIFY' },
    });
    assert(decisionLog !== null, 'Saved ApprovalDecision audit record for MODIFY');

    // -------------------------------------------------------------------------
    // TEST 5: Reject Invalid Reassignment (Prevent Overlapping Conflict)
    // -------------------------------------------------------------------------
    console.log('\n6. Testing Conflict Prevention during MODIFY...');
    // Create Booking 3 and attempt to modify into Room A during Booking 1's confirmed slot
    const booking3 = await prisma.booking.create({
      data: {
        bookingNumber: 'P5-BK-003',
        userId: requesterUser1.id,
        resourceId: roomC.id,
        departmentId: testDept.id,
        startTime: new Date(tomorrow.getTime() + 24 * 3600000), // Day after
        endTime: new Date(tomorrowEnd.getTime() + 24 * 3600000),
        purpose: 'Robotics Seminar',
        expectedAttendance: 20,
        status: BookingStatus.PENDING,
      },
    });

    let conflictCaught = false;
    try {
      await processApprovalAction({
        bookingId: booking3.id,
        approver: approverContext as any,
        action: 'MODIFY',
        alternateResourceId: roomA.id, // Conflict with Booking 1!
        newStartTime: tomorrow,
        newEndTime: tomorrowEnd,
        notes: 'Attempting invalid reassignment to occupied slot',
      });
    } catch (err: any) {
      if (err.statusCode === 409 || err.message.includes('conflict')) {
        conflictCaught = true;
      }
    }
    assert(conflictCaught, 'Prevented MODIFY from creating overlapping confirmed slot (409)');

    // -------------------------------------------------------------------------
    // TEST 6: Prevent Unauthorized Department Resource Reassignment
    // -------------------------------------------------------------------------
    console.log('\n7. Testing Department Authorization Boundary on MODIFY...');
    let unauthCaught = false;
    try {
      await processApprovalAction({
        bookingId: booking3.id,
        approver: approverContext as any,
        action: 'MODIFY',
        alternateResourceId: roomD.id, // Foreign Dept!
        newStartTime: booking3.startTime,
        newEndTime: booking3.endTime,
        notes: 'Attempting unauthorized departmental reassignment',
      });
    } catch (err: any) {
      if (err.statusCode === 403 || err.message.includes('Forbidden')) {
        unauthCaught = true;
      }
    }
    assert(unauthCaught, 'Blocked MODIFY to unauthorized department resource (403)');

    // Clean up test bookings
    await prisma.booking.deleteMany({
      where: { bookingNumber: { in: ['P5-BK-001', 'P5-BK-002', 'P5-BK-003'] } },
    });

    console.log(`\n========================================`);
    console.log(`P5 TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error in P5 test suite:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runP5Tests();
