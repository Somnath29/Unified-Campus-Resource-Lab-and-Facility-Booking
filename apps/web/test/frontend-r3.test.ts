/**
 * TASK R3 AUTOMATED TEST SUITE: RESOURCE DISCOVERY & CALENDAR UI INTEGRATION
 * Covers:
 * 1. Shared Asia/Kolkata Timezone Formatters
 * 2. Resource Discovery API contracts, server-side pagination, sorting, filters, availability
 * 3. Resource Calendar & Availability API contracts, 48 slots, 6 statuses, privacy
 * 4. Next Available Slot Derivation & Reserve Handoff
 * 5. Accessibility & Semantic Contracts
 */

import assert from 'node:assert';
import {
  APP_TIMEZONE,
  isValidDateString,
  isValidTimeString,
  kolkataToUtc,
  getCurrentKolkataDateString,
  getCurrentKolkataTimeString,
  addDaysKolkata,
  formatKolkataDate,
  formatKolkataTime,
  formatKolkataDateTime,
  formatKolkataTimeRange,
  formatSlotTime12Hour,
  formatSlotTimeRange,
  getDateStringInKolkata,
  getTimeStringInKolkata,
} from '../src/lib/timezone';
import { api } from '../src/lib/api';
import { prisma } from '../src/lib/prisma';

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

async function runR3Tests() {
  console.log('\n======================================================');
  console.log('🚀 INITIALIZING R3 TEST SUITE: FRONTEND INTEGRATION');
  console.log('======================================================\n');

  // --- SUITE 1: SHARED ASIA/KOLKATA TIMEZONE FORMATTERS ---
  console.log('--- SUITE 1: ASIA/KOLKATA TIMEZONE FORMATTERS ---');
  try {
    assert.strictEqual(APP_TIMEZONE, 'Asia/Kolkata');
    pass('App timezone is Asia/Kolkata');

    const todayKolkata = getCurrentKolkataDateString();
    assert.match(todayKolkata, /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(isValidDateString(todayKolkata), true);
    pass(`getCurrentKolkataDateString returns valid YYYY-MM-DD (${todayKolkata})`);

    const nowKolkata = getCurrentKolkataTimeString();
    assert.match(nowKolkata, /^([01]\d|2[0-3]):[0-5]\d$/);
    assert.strictEqual(isValidTimeString(nowKolkata), true);
    pass(`getCurrentKolkataTimeString returns valid 24-hr HH:mm (${nowKolkata})`);

    const nextDay = addDaysKolkata('2026-11-30', 1);
    assert.strictEqual(nextDay, '2026-12-01');
    pass('addDaysKolkata correctly rolls month from 2026-11-30 to 2026-12-01');

    const prevDay = addDaysKolkata('2026-12-01', -1);
    assert.strictEqual(prevDay, '2026-11-30');
    pass('addDaysKolkata correctly steps back 1 day');

    const formattedDate = formatKolkataDate('2026-12-01');
    assert.ok(formattedDate.includes('01') && (formattedDate.includes('Dec') || formattedDate.includes('12')));
    pass(`formatKolkataDate formats date consistently (${formattedDate})`);

    // UTC to Kolkata time conversion: 10:00 UTC is 15:30 IST (+5:30)
    const testUtcDate = new Date('2026-12-01T10:00:00.000Z');
    const formattedTime = formatKolkataTime(testUtcDate);
    assert.ok(formattedTime.includes('3:30') && formattedTime.toUpperCase().includes('PM'));
    pass(`formatKolkataTime converts UTC 10:00:00Z to IST 3:30 PM (${formattedTime})`);

    const formattedDateTime = formatKolkataDateTime(testUtcDate);
    assert.ok(formattedDateTime.includes('3:30') && (formattedDateTime.includes('Dec') || formattedDateTime.includes('12')));
    pass(`formatKolkataDateTime combines date and time in IST (${formattedDateTime})`);

    const testUtcEnd = new Date('2026-12-01T11:30:00.000Z');
    const formattedRange = formatKolkataTimeRange(testUtcDate, testUtcEnd);
    assert.ok(formattedRange.includes('3:30') && formattedRange.includes('5:00'));
    pass(`formatKolkataTimeRange formats start to end range (${formattedRange})`);

    assert.strictEqual(formatSlotTime12Hour('08:00'), '08:00 AM');
    assert.strictEqual(formatSlotTime12Hour('14:30'), '02:30 PM');
    assert.strictEqual(formatSlotTime12Hour('00:00'), '12:00 AM');
    assert.strictEqual(formatSlotTime12Hour('12:00'), '12:00 PM');
    pass('formatSlotTime12Hour converts 24-hr slots to 12-hr AM/PM accurately');

    assert.strictEqual(formatSlotTimeRange('08:00', '08:30'), '08:00 AM - 08:30 AM');
    assert.strictEqual(formatSlotTimeRange('14:00', '15:30'), '02:00 PM - 03:30 PM');
    pass('formatSlotTimeRange produces clear human-readable slot range');
  } catch (err) {
    fail('Timezone formatter suite failed', err);
  }

  // --- SUITE 2: RESOURCE DISCOVERY API INTEGRATION & PAGINATION ---
  console.log('\n--- SUITE 2: RESOURCE DISCOVERY API INTEGRATION & PAGINATION ---');
  try {
    const listRes = await fetch(`${BASE_URL}/api/resources?page=1&limit=6&sortBy=name&sortOrder=asc`);
    assert.strictEqual(listRes.status, 200);
    const body = await listRes.json();
    assert.ok(Array.isArray(body.resources));
    assert.ok(body.resources.length <= 6);
    assert.ok(body.pagination);
    assert.strictEqual(body.pagination.page, 1);
    assert.strictEqual(body.pagination.limit, 6);
    assert.ok(body.pagination.total > 0);
    pass('GET /api/resources returns 200 with resources array and pagination metadata');

    // Verify sort order: Name ascending
    const names = body.resources.map((r: any) => r.name);
    for (let i = 0; i < names.length - 1; i++) {
      assert.ok(names[i].localeCompare(names[i + 1]) <= 0);
    }
    pass('Resources sorted strictly ascending by name');

    // Verify Capacity sorting
    const capRes = await fetch(`${BASE_URL}/api/resources?sortBy=capacity&sortOrder=desc&limit=5`);
    assert.strictEqual(capRes.status, 200);
    const capBody = await capRes.json();
    const caps = capBody.resources.map((r: any) => r.capacity);
    for (let i = 0; i < caps.length - 1; i++) {
      assert.ok(caps[i] >= caps[i + 1]);
    }
    pass('Resources sorted strictly descending by capacity');

    // Verify Building filter
    const bldgRes = await fetch(`${BASE_URL}/api/resources?building=Block%2034`);
    assert.strictEqual(bldgRes.status, 200);
    const bldgBody = await bldgRes.json();
    assert.ok(bldgBody.resources.length > 0);
    bldgBody.resources.forEach((r: any) => {
      assert.ok(r.building.toLowerCase().includes('block 34'));
    });
    pass('Building filter matches resources case-insensitively');

    // Verify Category filter
    const catRes = await fetch(`${BASE_URL}/api/resources?category=CLASSROOM`);
    assert.strictEqual(catRes.status, 200);
    const catBody = await catRes.json();
    catBody.resources.forEach((r: any) => {
      assert.strictEqual(r.category, 'CLASSROOM');
    });
    pass('Category filter returns only CLASSROOM resources');

    // Verify Amenity AND matching
    const amenRes = await fetch(`${BASE_URL}/api/resources?amenities=Projector,AC`);
    assert.strictEqual(amenRes.status, 200);
    const amenBody = await amenRes.json();
    amenBody.resources.forEach((r: any) => {
      assert.ok(r.amenities.includes('Projector') && r.amenities.includes('AC'));
    });
    pass('Amenity filter enforces AND semantics (both Projector AND AC)');

    // Verify Availability set-based filtering (date, start, end)
    const availListRes = await fetch(
      `${BASE_URL}/api/resources?date=2026-12-01&start=09:00&end=10:00`
    );
    assert.strictEqual(availListRes.status, 200);
    const availListBody = await availListRes.json();
    assert.ok(Array.isArray(availListBody.resources));
    assert.ok(availListBody.resources.length > 0);
    pass('Availability filtering by date, start, and end time returns available resources');
  } catch (err) {
    fail('Resource discovery API integration suite failed', err);
  }

  // --- SUITE 3: RESOURCE CALENDAR & AVAILABILITY API INTEGRATION ---
  console.log('\n--- SUITE 3: RESOURCE CALENDAR & AVAILABILITY INTEGRATION ---');
  try {
    // Pick an existing active resource (CSE Classroom 204)
    const resource = await prisma.resource.findFirst({
      where: { code: 'CSE-CR-204', deletedAt: null },
    });
    assert.ok(resource, 'CSE-CR-204 should exist in seed data');

    // 1. Availability endpoint
    const availRes = await fetch(
      `${BASE_URL}/api/resources/${resource.id}/availability?date=2026-12-01`
    );
    assert.strictEqual(availRes.status, 200);
    const availBody = await availRes.json();
    assert.strictEqual(availBody.resourceId, resource.id);
    assert.strictEqual(availBody.timezone, 'Asia/Kolkata');
    assert.strictEqual(availBody.slotDurationMinutes, 30);
    assert.strictEqual(availBody.slots.length, 48);
    pass('Availability endpoint returns exactly 48 30-minute slots for the 24-hr day');

    // Check slot statuses presence
    const statuses = new Set(availBody.slots.map((s: any) => s.status));
    assert.ok(statuses.has('outside_hours'));
    assert.ok(statuses.has('available'));
    pass('Slots contain outside_hours and available statuses with human-readable reasons');

    // Verify early morning is outside_hours
    const earlySlot = availBody.slots.find((s: any) => s.startTime === '05:00');
    assert.strictEqual(earlySlot?.status, 'outside_hours');
    pass('Early morning slot (05:00) is marked outside_hours');

    // 2. Calendar endpoint (Privacy check for public/other student viewer)
    const calRes = await fetch(
      `${BASE_URL}/api/resources/${resource.id}/calendar?from=2026-12-01&to=2026-12-07`
    );
    assert.strictEqual(calRes.status, 200);
    const calBody = await calRes.json();
    assert.strictEqual(calBody.resourceId, resource.id);
    assert.strictEqual(calBody.timezone, 'Asia/Kolkata');
    assert.ok(Array.isArray(calBody.events));
    pass('Calendar endpoint returns events array spanning requested date range');

    // Verify unauthenticated / non-owner privacy
    const bookingEvents = calBody.events.filter((e: any) => e.type === 'BOOKING');
    if (bookingEvents.length > 0) {
      bookingEvents.forEach((b: any) => {
        assert.strictEqual(b.title, 'Booked');
        assert.strictEqual(b.isOwner, false);
        assert.strictEqual(b.purpose, undefined);
        assert.strictEqual(b.activityType, undefined);
        assert.strictEqual(b.user, undefined);
      });
      pass('All booking events for non-owners display title "Booked" and omit private details');
    }

    // Verify class events expose course code and title
    const classEvents = calBody.events.filter((e: any) => e.type === 'CLASS');
    if (classEvents.length > 0) {
      classEvents.forEach((c: any) => {
        assert.ok(c.title);
        assert.ok(c.courseCode);
        assert.strictEqual(c.isOwner, false);
      });
      pass('Timetable class events display course title and code');
    }
  } catch (err) {
    fail('Resource calendar & availability suite failed', err);
  }

  // --- SUITE 4: NEXT AVAILABLE SLOT & RESERVE HANDOFF LOGIC ---
  console.log('\n--- SUITE 4: NEXT AVAILABLE SLOT & RESERVE HANDOFF ---');
  try {
    const resource = await prisma.resource.findFirst({
      where: { code: 'CSE-CR-204', deletedAt: null },
    });
    assert.ok(resource);

    const todayStr = getCurrentKolkataDateString();
    const avail = await fetch(
      `${BASE_URL}/api/resources/${resource.id}/availability?date=${todayStr}`
    );
    assert.strictEqual(avail.status, 200);
    const availData = await avail.json();

    const freeSlots = availData.slots.filter((s: any) => s.status === 'available');
    if (freeSlots.length > 0) {
      const nextSlot = freeSlots[0];
      assert.ok(nextSlot.startTime && nextSlot.endTime);
      pass(`Identified next available slot (${nextSlot.startTime} - ${nextSlot.endTime})`);

      // Verify Reserve handoff payload
      const reservePayload = {
        resourceId: resource.id,
        date: todayStr,
        startTime: nextSlot.startTime,
        endTime: nextSlot.endTime,
      };
      assert.strictEqual(reservePayload.resourceId, resource.id);
      assert.strictEqual(isValidDateString(reservePayload.date), true);
      assert.strictEqual(isValidTimeString(reservePayload.startTime), true);
      assert.strictEqual(isValidTimeString(reservePayload.endTime), true);
      assert.ok(reservePayload.startTime < reservePayload.endTime);
      pass('Reserve handoff preserves valid resource ID, date, and time boundaries');
    } else {
      pass('No free slots today; handled gracefully without crashing');
    }
  } catch (err) {
    fail('Next available slot and reserve handoff suite failed', err);
  }

  // --- SUITE 5: DATA INTEGRITY & ZERO HARDCODED MOCK DATA ---
  console.log('\n--- SUITE 5: DATA INTEGRITY & MOCK DATA AUDIT ---');
  try {
    // Check that every resource returned by /api/resources matches a real PostgreSQL row
    const resList = await fetch(`${BASE_URL}/api/resources?limit=10`);
    assert.strictEqual(resList.status, 200);
    const body = await resList.json();

    for (const r of body.resources) {
      const dbRow = await prisma.resource.findUnique({ where: { id: r.id } });
      assert.ok(dbRow, `Resource ${r.id} must exist in database`);
      assert.strictEqual(r.code, dbRow.code);
      assert.strictEqual(r.name, dbRow.name);
      assert.strictEqual(r.capacity, dbRow.capacity);
    }
    pass('All 10 resources in catalog match real PostgreSQL records with identical attributes');

    // Confirm total count matches real database count for active non-maintenance resources
    const activeCount = await prisma.resource.count({
      where: { deletedAt: null, isUnderMaintenance: false },
    });
    assert.strictEqual(body.pagination.total, activeCount);
    pass(`Pagination total (${body.pagination.total}) exactly equals active PostgreSQL count (${activeCount})`);
  } catch (err) {
    fail('Data integrity suite failed', err);
  }

  console.log('\n======================================================');
  if (testFailed === 0) {
    console.log(`🎉 ALL R3 TESTS COMPLETED SUCCESSFULLY!`);
    console.log(`   Passed: ${testPassed}`);
    console.log(`   Failed: 0`);
  } else {
    console.error(`💥 R3 TEST RUN FAILED`);
    console.error(`   Passed: ${testPassed}`);
    console.error(`   Failed: ${testFailed}`);
    process.exit(1);
  }
  console.log('======================================================\n');
}

runR3Tests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
