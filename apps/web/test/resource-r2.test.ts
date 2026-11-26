/**
 * Comprehensive Automated Test Suite for Task R2:
 * Production-Grade Resource Discovery, Availability API & Calendar API
 *
 * Run with: npx tsx --tsconfig apps/web/tsconfig.json apps/web/test/resource-r2.test.ts
 */

import { prisma } from '../src/lib/prisma';
import { BookingStatus, Role, PriorityLevel, ActivityType } from '@prisma/client';
import { signToken } from '../src/lib/auth';
import { kolkataToUtc, getDayOfWeekInKolkata } from '../src/lib/timezone';

const BASE_URL = 'http://localhost:3000';

let userA: { id: string; email: string; name: string; token: string };
let userB: { id: string; email: string; name: string; token: string };

let primaryTestResource: any;
let secondaryTestResource: any;

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

async function setup() {
  console.log('\n======================================================');
  console.log('🚀 INITIALIZING R2 TEST ENVIRONMENT & SEED DATA');
  console.log('======================================================\n');

  // Load User A (Student Ketan) and User B (Other Student)
  const student = await prisma.user.findUnique({ where: { email: 'ketan.12204598@lpu.in' } });
  if (!student) throw new Error('Student user not found.');

  let otherStudent = await prisma.user.findUnique({ where: { email: 'other.student@lpu.in' } });
  if (!otherStudent) {
    otherStudent = await prisma.user.create({
      data: {
        email: 'other.student@lpu.in',
        name: 'Sneha Patel',
        passwordHash: student.passwordHash,
        role: Role.STUDENT,
        department: 'School of Computer Science & Engineering',
      },
    });
  }

  userA = {
    id: student.id,
    email: student.email,
    name: student.name,
    token: signToken({ id: student.id, email: student.email, role: student.role }),
  };

  userB = {
    id: otherStudent.id,
    email: otherStudent.email,
    name: otherStudent.name,
    token: signToken({ id: otherStudent.id, email: otherStudent.email, role: otherStudent.role }),
  };

  // Find or create resources for testing
  primaryTestResource = await prisma.resource.findFirst({
    where: { code: 'CSE-CR-204', deletedAt: null },
  }) || await prisma.resource.findFirst({
    where: { category: 'CLASSROOM', deletedAt: null },
  });

  secondaryTestResource = await prisma.resource.findFirst({
    where: { code: 'CSE-LAB-03', deletedAt: null },
  }) || await prisma.resource.findFirst({
    where: { category: 'LAB', deletedAt: null },
  });

  // Ensure clean initial state
  await prisma.resource.updateMany({
    data: { isUnderMaintenance: false, maintenanceReason: null },
  });

  if (!primaryTestResource || !secondaryTestResource) {
    throw new Error('Required test resources not found in database.');
  }

  // Clean up previous test artifacts
  await prisma.booking.deleteMany({
    where: { purpose: { startsWith: 'R2-TEST-' } },
  });
  await prisma.timetableEntry.deleteMany({
    where: { courseCode: { startsWith: 'R2-TT-' } },
  });

  console.log(`Primary Resource: ${primaryTestResource.name} (${primaryTestResource.code})`);
  console.log(`Secondary Resource: ${secondaryTestResource.name} (${secondaryTestResource.code})`);
  console.log(`User A (Owner): ${userA.name} (${userA.email})`);
  console.log(`User B (Viewer): ${userB.name} (${userB.email})\n`);
}

/**
 * -------------------------------------------------------------
 * SUITE 1: GET /api/resources (Pagination, Sorting, Filtering)
 * -------------------------------------------------------------
 */
async function testResourceDiscovery() {
  console.log('--- SUITE 1: GET /api/resources (PAGINATION, SORTING & FILTERS) ---');

  // 1.1 Default pagination
  const resDefault = await fetch(`${BASE_URL}/api/resources`);
  const dataDefault = await resDefault.json();
  assert(resDefault.status === 200, 'GET /api/resources returns 200 OK');
  assert(dataDefault.pagination.page === 1, 'Default page is 1');
  assert(dataDefault.pagination.limit === 20, 'Default limit is 20');
  assert(Array.isArray(dataDefault.resources), 'Returns array of resources');
  assert(dataDefault.pagination.total > 0, 'Total count is greater than 0');

  // 1.2 Custom page size and pagination
  const resLimit = await fetch(`${BASE_URL}/api/resources?page=1&limit=2`);
  const dataLimit = await resLimit.json();
  assert(dataLimit.resources.length === 2, 'Page size limit=2 returns exactly 2 resources');
  assert(dataLimit.pagination.limit === 2, 'Pagination limit is 2');
  assert(dataLimit.pagination.hasNextPage === true, 'hasNextPage is true when more items exist');
  assert(dataLimit.pagination.hasPrevPage === false, 'hasPrevPage is false on page 1');

  // Page 2
  const resPage2 = await fetch(`${BASE_URL}/api/resources?page=2&limit=2`);
  const dataPage2 = await resPage2.json();
  assert(dataPage2.resources.length === 2, 'Page 2 returns 2 resources');
  assert(dataPage2.pagination.page === 2, 'Current page is 2');
  assert(dataPage2.pagination.hasPrevPage === true, 'hasPrevPage is true on page 2');
  assert(
    dataLimit.resources[0].id !== dataPage2.resources[0].id,
    'No duplicates between page 1 and page 2'
  );

  // 1.3 Empty page beyond total
  const resEmptyPage = await fetch(`${BASE_URL}/api/resources?page=9999&limit=20`);
  const dataEmptyPage = await resEmptyPage.json();
  assert(dataEmptyPage.resources.length === 0, 'Page beyond total returns empty array');
  assert(dataEmptyPage.pagination.page === 9999, 'Empty page reflects requested page number');

  // 1.4 Invalid pagination parameters rejected
  const resInvalidPage = await fetch(`${BASE_URL}/api/resources?page=0`);
  assert(resInvalidPage.status === 400, 'Page 0 is rejected with 400');

  const resNegativePage = await fetch(`${BASE_URL}/api/resources?page=-1`);
  assert(resNegativePage.status === 400, 'Negative page is rejected with 400');

  const resAlphaPage = await fetch(`${BASE_URL}/api/resources?page=abc`);
  assert(resAlphaPage.status === 400, 'Non-numeric page is rejected with 400');

  const resOverLimit = await fetch(`${BASE_URL}/api/resources?limit=150`);
  assert(resOverLimit.status === 400, 'Limit > 100 is rejected with 400');

  const resZeroLimit = await fetch(`${BASE_URL}/api/resources?limit=0`);
  assert(resZeroLimit.status === 400, 'Limit 0 is rejected with 400');

  // 1.5 Sorting: by name asc / desc
  const resSortAsc = await fetch(`${BASE_URL}/api/resources?sortBy=name&sortOrder=asc&limit=10`);
  const dataSortAsc = await resSortAsc.json();
  const namesAsc = dataSortAsc.resources.map((r: any) => r.name);
  const sortedNamesAsc = [...namesAsc].sort((a, b) => a.localeCompare(b));
  assert(
    JSON.stringify(namesAsc) === JSON.stringify(sortedNamesAsc),
    'Resources sorted ascending by name'
  );

  const resSortDesc = await fetch(`${BASE_URL}/api/resources?sortBy=name&sortOrder=desc&limit=10`);
  const dataSortDesc = await resSortDesc.json();
  const namesDesc = dataSortDesc.resources.map((r: any) => r.name);
  const sortedNamesDesc = [...namesDesc].sort((a, b) => b.localeCompare(a));
  assert(
    JSON.stringify(namesDesc) === JSON.stringify(sortedNamesDesc),
    'Resources sorted descending by name'
  );

  // Sorting: by capacity desc
  const resCapDesc = await fetch(`${BASE_URL}/api/resources?sortBy=capacity&sortOrder=desc&limit=5`);
  const dataCapDesc = await resCapDesc.json();
  const caps = dataCapDesc.resources.map((r: any) => r.capacity);
  assert(caps[0] >= caps[1] && caps[1] >= caps[2], 'Resources sorted descending by capacity');

  // Invalid sort field & order
  const resInvalidSortField = await fetch(`${BASE_URL}/api/resources?sortBy=passwordHash`);
  assert(resInvalidSortField.status === 400, 'Invalid sortBy field rejected with 400');

  const resInvalidSortOrder = await fetch(`${BASE_URL}/api/resources?sortOrder=sideways`);
  assert(resInvalidSortOrder.status === 400, 'Invalid sortOrder rejected with 400');

  // 1.6 Filters: Category
  const resCat = await fetch(`${BASE_URL}/api/resources?category=CLASSROOM`);
  const dataCat = await resCat.json();
  assert(
    dataCat.resources.every((r: any) => r.category === 'CLASSROOM'),
    'Category filter returns only CLASSROOM resources'
  );

  // Filters: Building
  const resBldg = await fetch(`${BASE_URL}/api/resources?building=CSE`);
  const dataBldg = await resBldg.json();
  assert(
    dataBldg.resources.length > 0 &&
      dataBldg.resources.every((r: any) => r.building.toLowerCase().includes('cse')),
    'Building filter matches building name case-insensitively'
  );

  // Filters: Capacity range
  const resCapRange = await fetch(`${BASE_URL}/api/resources?minCapacity=30&maxCapacity=60`);
  const dataCapRange = await resCapRange.json();
  assert(
    dataCapRange.resources.every((r: any) => r.capacity >= 30 && r.capacity <= 60),
    'Capacity range filter strictly returns resources with 30 <= capacity <= 60'
  );

  // Invalid capacity: min > max
  const resInvalidCapRange = await fetch(`${BASE_URL}/api/resources?minCapacity=80&maxCapacity=40`);
  assert(resInvalidCapRange.status === 400, 'minCapacity > maxCapacity rejected with 400');

  // Filters: Amenities (AND semantics: hasEvery)
  const resAmenity = await fetch(`${BASE_URL}/api/resources?amenities=Projector`);
  const dataAmenity = await resAmenity.json();
  assert(
    dataAmenity.resources.every((r: any) => r.amenities.includes('Projector')),
    'Single amenity filter returns resources containing Projector'
  );

  const resMultiAmenity = await fetch(`${BASE_URL}/api/resources?amenities=Projector,Smart%20Board`);
  const dataMultiAmenity = await resMultiAmenity.json();
  assert(
    dataMultiAmenity.resources.every(
      (r: any) => r.amenities.includes('Projector') && r.amenities.includes('Smart Board')
    ),
    'Multiple amenities filter uses AND semantics (contains Projector AND Smart Board)'
  );

  // Filters: Text Search (case-insensitive across name, code, building, department)
  const resSearch = await fetch(`${BASE_URL}/api/resources?search=classroom%20204`);
  const dataSearch = await resSearch.json();
  assert(
    dataSearch.resources.some((r: any) => r.name.toLowerCase().includes('classroom 204')),
    'Text search matches resource name case-insensitively'
  );

  // Soft-deleted resources never returned
  const softDel = await prisma.resource.create({
    data: {
      code: `R2-SOFT-${Date.now()}`,
      name: 'R2 Hidden Resource',
      category: 'CLASSROOM',
      department: 'School of Computer Science & Engineering',
      building: 'Block 34',
      capacity: 30,
      imageUrl: 'https://example.com/img.jpg',
      deletedAt: new Date(),
    },
  });

  const resSoftCheck = await fetch(`${BASE_URL}/api/resources?search=R2%20Hidden%20Resource`);
  const dataSoftCheck = await resSoftCheck.json();
  assert(
    !dataSoftCheck.resources.some((r: any) => r.id === softDel.id),
    'Soft-deleted resource is strictly excluded from resource list'
  );
  await prisma.resource.delete({ where: { id: softDel.id } });
}

/**
 * -------------------------------------------------------------
 * SUITE 2: Optional Availability Filtering on GET /api/resources
 * -------------------------------------------------------------
 */
async function testAvailabilityListFiltering() {
  console.log('\n--- SUITE 2: GET /api/resources OPTIONAL AVAILABILITY FILTERING (SET-BASED) ---');

  // Choose an isolated future date: Day + 20
  const targetDateStr = '2026-12-16';
  const startStr = '10:00';
  const endStr = '12:00';

  const startUtc = kolkataToUtc(targetDateStr, startStr);
  const endUtc = kolkataToUtc(targetDateStr, endStr);

  // 2.1 Clean slate: resource without conflicts is included
  const resBefore = await fetch(
    `${BASE_URL}/api/resources?date=${targetDateStr}&start=${startStr}&end=${endStr}`
  );
  const dataBefore = await resBefore.json();
  assert(resBefore.status === 200, 'Availability filtering returns 200 OK');
  assert(
    dataBefore.resources.some((r: any) => r.id === primaryTestResource.id),
    'Free resource is included in available resources list'
  );

  // 2.2 Create active booking on primaryTestResource during this interval
  const testBooking = await prisma.booking.create({
    data: {
      bookingNumber: `LPU-2026-R2-${Date.now().toString().slice(-6)}`,
      userId: userA.id,
      resourceId: primaryTestResource.id,
      startTime: startUtc,
      endTime: endUtc,
      purpose: 'R2-TEST-Active overlapping booking',
      status: BookingStatus.CONFIRMED,
    },
  });

  // Now filter again: primaryTestResource MUST be excluded
  const resAfterBooking = await fetch(
    `${BASE_URL}/api/resources?date=${targetDateStr}&start=${startStr}&end=${endStr}`
  );
  const dataAfterBooking = await resAfterBooking.json();
  assert(
    !dataAfterBooking.resources.some((r: any) => r.id === primaryTestResource.id),
    'Resource with overlapping active booking is excluded from available list'
  );

  // 2.3 Cancel the booking: resource should become available again
  await prisma.booking.update({
    where: { id: testBooking.id },
    data: { status: BookingStatus.CANCELLED },
  });

  const resAfterCancel = await fetch(
    `${BASE_URL}/api/resources?date=${targetDateStr}&start=${startStr}&end=${endStr}`
  );
  const dataAfterCancel = await resAfterCancel.json();
  assert(
    dataAfterCancel.resources.some((r: any) => r.id === primaryTestResource.id),
    'Cancelled booking does NOT block resource availability'
  );

  // Clean up booking
  await prisma.booking.delete({ where: { id: testBooking.id } });

  // 2.4 Timetable entry conflict excludes resource
  const dayOfWeek = getDayOfWeekInKolkata(startUtc);
  const testTimetable = await prisma.timetableEntry.create({
    data: {
      resourceId: primaryTestResource.id,
      courseCode: 'R2-TT-101',
      courseName: 'Advanced Database Systems',
      instructorName: 'Prof. Raman',
      dayOfWeek,
      startTime: '10:00',
      endTime: '11:30',
      department: primaryTestResource.department,
      semester: '5',
      section: 'K22CS',
    },
  });

  const resAfterTimetable = await fetch(
    `${BASE_URL}/api/resources?date=${targetDateStr}&start=${startStr}&end=${endStr}`
  );
  const dataAfterTimetable = await resAfterTimetable.json();
  assert(
    !dataAfterTimetable.resources.some((r: any) => r.id === primaryTestResource.id),
    'Resource with overlapping timetable class is excluded from available list'
  );

  await prisma.timetableEntry.delete({ where: { id: testTimetable.id } });

  // 2.5 Validation: Missing start or end rejected
  const resMissingEnd = await fetch(
    `${BASE_URL}/api/resources?date=${targetDateStr}&start=${startStr}`
  );
  assert(resMissingEnd.status === 400, 'Missing end parameter is rejected with 400');

  // Validation: End <= Start rejected
  const resInverted = await fetch(
    `${BASE_URL}/api/resources?date=${targetDateStr}&start=14:00&end=12:00`
  );
  assert(resInverted.status === 400, 'start >= end is rejected with 400');

  // Validation: Invalid date rejected
  const resBadDate = await fetch(
    `${BASE_URL}/api/resources?date=2026-02-31&start=10:00&end=11:00`
  );
  assert(resBadDate.status === 400, 'Invalid calendar date is rejected with 400');
}

/**
 * -------------------------------------------------------------
 * SUITE 3: GET /api/resources/:id/availability (Daily 30-min Slots)
 * -------------------------------------------------------------
 */
async function testDailyAvailability() {
  console.log('\n--- SUITE 3: GET /api/resources/:id/availability (30-MIN SLOTS & 6 STATUSES) ---');

  const targetDateStr = '2026-12-18';
  const url = `${BASE_URL}/api/resources/${primaryTestResource.id}/availability?date=${targetDateStr}`;

  // 3.1 Fetch initial availability
  const res = await fetch(url);
  const data = await res.json();

  assert(res.status === 200, 'Daily availability endpoint returns 200 OK');
  assert(data.resourceId === primaryTestResource.id, 'Response matches requested resource ID');
  assert(data.timezone === 'Asia/Kolkata', 'Timezone is Asia/Kolkata');
  assert(data.slotDurationMinutes === 30, 'Slot duration is 30 minutes');
  assert(data.slots.length === 48, 'Generates exactly 48 30-minute slots for the 24-hour day');

  // 3.2 Outside hours verification
  // Resource operating hours: 08:00 AM - 08:00 PM (08:00 - 20:00)
  const slotEarly = data.slots.find((s: any) => s.startTime === '06:00');
  assert(slotEarly.status === 'outside_hours', 'Early morning slot (06:00) is marked outside_hours');
  assert(
    slotEarly.reason === 'Outside resource operating hours',
    'outside_hours has human-readable reason'
  );

  const slotLate = data.slots.find((s: any) => s.startTime === '21:30');
  assert(slotLate.status === 'outside_hours', 'Late night slot (21:30) is marked outside_hours');

  // 3.3 Available status verification
  const slotFree = data.slots.find((s: any) => s.startTime === '14:00');
  assert(slotFree.status === 'available', 'Free afternoon slot (14:00) is marked available');
  assert(slotFree.reason === 'Available for booking', 'available has reason Available for booking');

  // 3.4 Booked status & Privacy check
  // Add a booking from 14:00 to 15:00 IST (08:30 to 09:30 UTC)
  const bStart = kolkataToUtc(targetDateStr, '14:00');
  const bEnd = kolkataToUtc(targetDateStr, '15:00');

  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `LPU-2026-R2-${Date.now().toString().slice(-6)}`,
      userId: userA.id,
      resourceId: primaryTestResource.id,
      startTime: bStart,
      endTime: bEnd,
      purpose: 'R2-TEST-Secret Strategic Faculty Review',
      status: BookingStatus.CONFIRMED,
    },
  });

  const resAfterBooking = await fetch(url);
  const dataAfterBooking = await resAfterBooking.json();

  const slotBooked1 = dataAfterBooking.slots.find((s: any) => s.startTime === '14:00');
  const slotBooked2 = dataAfterBooking.slots.find((s: any) => s.startTime === '14:30');
  const slotAdjacent = dataAfterBooking.slots.find((s: any) => s.startTime === '15:00');

  assert(slotBooked1.status === 'booked', '14:00-14:30 slot is marked booked');
  assert(slotBooked2.status === 'booked', '14:30-15:00 slot is marked booked');
  assert(
    slotBooked1.reason === 'Resource is already booked',
    'booked slot has generic reason Resource is already booked'
  );
  assert(
    slotAdjacent.status === 'available',
    'Adjacent slot starting at 15:00 is available (half-open interval)'
  );

  // PRIVACY ASSERTION: Confirm availability JSON contains NO trace of private purpose or user
  const rawAvailabilityText = JSON.stringify(dataAfterBooking);
  assert(
    !rawAvailabilityText.includes('Secret Strategic Faculty Review'),
    'Daily availability strictly leaks NO private booking purpose'
  );
  assert(
    !rawAvailabilityText.includes(userA.email) && !rawAvailabilityText.includes(userA.name),
    'Daily availability strictly leaks NO user email or name'
  );

  await prisma.booking.delete({ where: { id: booking.id } });

  // 3.5 Class / Timetable status verification
  const dayOfWeek = getDayOfWeekInKolkata(bStart);
  const ttClass = await prisma.timetableEntry.create({
    data: {
      resourceId: primaryTestResource.id,
      courseCode: 'R2-TT-CSE402',
      courseName: 'Distributed Cloud Systems',
      instructorName: 'Dr. Verma',
      dayOfWeek,
      startTime: '11:00',
      endTime: '12:30',
      department: primaryTestResource.department,
      semester: '7',
      section: 'K22BB',
    },
  });

  const resAfterClass = await fetch(url);
  const dataAfterClass = await resAfterClass.json();

  const slotClass1 = dataAfterClass.slots.find((s: any) => s.startTime === '11:00');
  const slotClass2 = dataAfterClass.slots.find((s: any) => s.startTime === '12:00');
  assert(slotClass1.status === 'class', '11:00 slot is marked class');
  assert(
    slotClass1.reason === 'Unavailable due to a scheduled class',
    'class slot has reason Unavailable due to a scheduled class'
  );
  assert(slotClass2.status === 'class', '12:00 slot is marked class');

  await prisma.timetableEntry.delete({ where: { id: ttClass.id } });

  // 3.6 Maintenance status verification
  await prisma.resource.update({
    where: { id: primaryTestResource.id },
    data: {
      isUnderMaintenance: true,
      maintenanceReason: 'Server Room Air Conditioning Repair',
    },
  });

  const resMaint = await fetch(url);
  const dataMaint = await resMaint.json();

  const slotInMaint = dataMaint.slots.find((s: any) => s.startTime === '10:00');
  assert(slotInMaint.status === 'maintenance', 'Slot during maintenance is marked maintenance');
  assert(
    slotInMaint.reason.includes('Air Conditioning Repair'),
    'maintenance slot includes maintenance reason'
  );

  // Restore resource maintenance status
  await prisma.resource.update({
    where: { id: primaryTestResource.id },
    data: { isUnderMaintenance: false, maintenanceReason: null },
  });

  // 3.7 Blackout status verification
  const blackoutStart = kolkataToUtc(targetDateStr, '09:00');
  const blackoutEnd = kolkataToUtc(targetDateStr, '11:00');

  await prisma.departmentPolicy.upsert({
    where: { department: primaryTestResource.department },
    update: {
      blackoutPeriods: JSON.stringify([
        {
          start: blackoutStart.toISOString(),
          end: blackoutEnd.toISOString(),
          reason: 'University Convocation Rehearsal',
        },
      ]),
    },
    create: {
      department: primaryTestResource.department,
      blackoutPeriods: JSON.stringify([
        {
          start: blackoutStart.toISOString(),
          end: blackoutEnd.toISOString(),
          reason: 'University Convocation Rehearsal',
        },
      ]),
    },
  });

  const resBlackout = await fetch(url);
  const dataBlackout = await resBlackout.json();

  const slotBlackout = dataBlackout.slots.find((s: any) => s.startTime === '09:30');
  assert(slotBlackout.status === 'blackout', 'Slot during blackout is marked blackout');
  assert(
    slotBlackout.reason === 'Unavailable due to a blackout period',
    'blackout slot has reason Unavailable due to a blackout period'
  );

  // Clean up policy blackout
  await prisma.departmentPolicy.update({
    where: { department: primaryTestResource.department },
    data: { blackoutPeriods: null },
  });

  // 3.8 Validation: Missing date & Invalid date
  const resNoDate = await fetch(
    `${BASE_URL}/api/resources/${primaryTestResource.id}/availability`
  );
  assert(resNoDate.status === 400, 'Missing date query parameter rejected with 400');

  const resBadDateFmt = await fetch(
    `${BASE_URL}/api/resources/${primaryTestResource.id}/availability?date=18-12-2026`
  );
  assert(resBadDateFmt.status === 400, 'Malformed date format rejected with 400');

  const resNotFoundRes = await fetch(
    `${BASE_URL}/api/resources/00000000-0000-0000-0000-000000000000/availability?date=2026-12-18`
  );
  assert(resNotFoundRes.status === 404, 'Non-existent resource returns 404');
}

/**
 * -------------------------------------------------------------
 * SUITE 4: GET /api/resources/:id/calendar (Strict Privacy & Events)
 * -------------------------------------------------------------
 */
async function testCalendarApi() {
  console.log('\n--- SUITE 4: GET /api/resources/:id/calendar (STRICT PRIVACY & EVENTS) ---');

  const fromDate = '2026-12-20';
  const toDate = '2026-12-22';

  // 4.1 Create test booking owned by User A with sensitive purpose
  const bStart = kolkataToUtc('2026-12-21', '10:00');
  const bEnd = kolkataToUtc('2026-12-21', '12:00');
  const privatePurpose = 'R2-TEST-Confidential PhD Defense and Patent Filing';

  const userABooking = await prisma.booking.create({
    data: {
      bookingNumber: `LPU-2026-R2-${Date.now().toString().slice(-6)}`,
      userId: userA.id,
      resourceId: primaryTestResource.id,
      startTime: bStart,
      endTime: bEnd,
      purpose: privatePurpose,
      activityType: ActivityType.PROJECT_WORK,
      status: BookingStatus.CONFIRMED,
    },
  });

  // 4.2 Create a timetable class for that Monday
  const dayOfWeek = getDayOfWeekInKolkata(bStart);
  const ttClass = await prisma.timetableEntry.create({
    data: {
      resourceId: primaryTestResource.id,
      courseCode: 'R2-TT-CSE501',
      courseName: 'Neural Networks Lab',
      instructorName: 'Dr. Anand',
      dayOfWeek,
      startTime: '14:00',
      endTime: '16:00',
      department: primaryTestResource.department,
      semester: '5',
      section: 'K22AB',
    },
  });

  // 4.3 Request calendar as User B (Different User -> MUST BE GENERIC 'Booked')
  const resUserB = await fetch(
    `${BASE_URL}/api/resources/${primaryTestResource.id}/calendar?from=${fromDate}&to=${toDate}`,
    {
      headers: {
        Authorization: `Bearer ${userB.token}`,
      },
    }
  );
  const dataUserB = await resUserB.json();

  assert(resUserB.status === 200, 'User B calendar request returns 200 OK');
  assert(dataUserB.timezone === 'Asia/Kolkata', 'Calendar timezone is Asia/Kolkata');

  const userBBookingEvent = dataUserB.events.find((e: any) => e.id === userABooking.id);
  assert(userBBookingEvent !== undefined, 'User B sees the booking slot on calendar');
  assert(
    userBBookingEvent.title === 'Booked',
    'MANDATORY PRIVACY: User B strictly sees title "Booked"'
  );
  assert(userBBookingEvent.isOwner === false, 'User B isOwner is false');
  assert(userBBookingEvent.purpose === undefined, 'User B receives NO purpose field');
  assert(userBBookingEvent.activityType === undefined, 'User B receives NO activityType field');

  // String check on raw response payload
  const rawUserBText = JSON.stringify(dataUserB);
  assert(
    !rawUserBText.includes(privatePurpose),
    'MANDATORY PRIVACY: Raw response to User B strictly does NOT contain private purpose string'
  );
  assert(
    !rawUserBText.includes(userA.email) && !rawUserBText.includes(userA.name),
    'MANDATORY PRIVACY: Raw response to User B strictly does NOT contain owner name or email'
  );

  // 4.4 Request calendar as User A (Owner -> SEES THEIR OWN PURPOSE)
  const resUserA = await fetch(
    `${BASE_URL}/api/resources/${primaryTestResource.id}/calendar?from=${fromDate}&to=${toDate}`,
    {
      headers: {
        Authorization: `Bearer ${userA.token}`,
      },
    }
  );
  const dataUserA = await resUserA.json();

  const userABookingEvent = dataUserA.events.find((e: any) => e.id === userABooking.id);
  assert(userABookingEvent.isOwner === true, 'User A isOwner is true for their booking');
  assert(
    userABookingEvent.title === privatePurpose,
    'User A sees their actual booking purpose in title'
  );
  assert(
    userABookingEvent.purpose === privatePurpose,
    'User A sees their actual purpose field'
  );

  // 4.5 Timetable Entry on Calendar
  const classEvent = dataUserB.events.find(
    (e: any) => e.type === 'CLASS' && e.courseCode === 'R2-TT-CSE501'
  );
  assert(classEvent !== undefined, 'Timetable class appears on calendar');
  assert(classEvent.title.includes('Neural Networks Lab'), 'Class event displays course name');
  assert(classEvent.courseCode === 'R2-TT-CSE501', 'Class event contains course code');
  assert(classEvent.isOwner === false, 'Class event has isOwner: false');

  // 4.6 Validation: Date range constraints
  const resMissingTo = await fetch(
    `${BASE_URL}/api/resources/${primaryTestResource.id}/calendar?from=${fromDate}`
  );
  assert(resMissingTo.status === 400, 'Missing to parameter rejected with 400');

  const resInvertedRange = await fetch(
    `${BASE_URL}/api/resources/${primaryTestResource.id}/calendar?from=2026-12-25&to=2026-12-20`
  );
  assert(resInvertedRange.status === 400, 'from > to rejected with 400');

  const resRangeTooLong = await fetch(
    `${BASE_URL}/api/resources/${primaryTestResource.id}/calendar?from=2026-01-01&to=2026-06-01`
  );
  assert(resRangeTooLong.status === 400, 'Range > 90 days rejected with 400');

  // Clean up test records
  await prisma.booking.delete({ where: { id: userABooking.id } });
  await prisma.timetableEntry.delete({ where: { id: ttClass.id } });
}

async function runAllTests() {
  try {
    await setup();
    await testResourceDiscovery();
    await testAvailabilityListFiltering();
    await testDailyAvailability();
    await testCalendarApi();

    console.log('\n======================================================');
    console.log(`🎉 ALL R2 TESTS COMPLETED SUCCESSFULLY!`);
    console.log(`   Passed: ${passedTests}`);
    console.log(`   Failed: ${failedTests}`);
    console.log('======================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ R2 TEST RUNNER FAILED WITH ERROR:\n', err);
    process.exit(1);
  }
}

runAllTests();
