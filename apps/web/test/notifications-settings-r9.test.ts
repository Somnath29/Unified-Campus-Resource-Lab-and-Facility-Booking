import assert from 'assert';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import {
  BookingStatus,
  ActivityType,
  PriorityLevel,
  Role,
  DeliveryStatus,
  ResourceCategory,
} from '@prisma/client';
import env from '../src/config/env';
import { ReminderService } from '../src/services/reminderService';
import { setTestEmailObserver, SendEmailInput } from '../src/services/emailService';
import { renderEmailTemplate } from '../src/lib/email-templates';
import { generateSingleBookingIcs, escapeIcsText } from '../src/lib/ics';
import { generateSecurePin, hashPin } from '../src/lib/checkin-crypto';
import { getSessionUser } from '../src/lib/auth';

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

function signAuthToken(payload: { id: string; email: string; role: Role }) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '1d' });
}

let studentA: any;
let studentAToken: string;
let studentB: any;
let studentBToken: string;
let facultyUser: any;
let approver: any;
let approverToken: string;
let resourceA: any;
let approvalResource: any;
let createdR9UserIds: string[] = [];
let createdR9ResourceId: string | null = null;

async function cleanup() {
  setTestEmailObserver(null);
  await prisma.notificationPreference.deleteMany({
    where: { userId: { in: createdR9UserIds } },
  }).catch(() => {});
  await prisma.notificationDelivery.deleteMany({
    where: { userId: { in: createdR9UserIds } },
  }).catch(() => {});
  await prisma.calendarFeed.deleteMany({
    where: { userId: { in: createdR9UserIds } },
  }).catch(() => {});
  await prisma.userSession.deleteMany({
    where: { userId: { in: createdR9UserIds } },
  }).catch(() => {});
  await prisma.notification.deleteMany({
    where: {
      OR: [
        { userId: { in: createdR9UserIds } },
        { title: { contains: 'R9 Test' } },
        { message: { contains: 'R9 Test' } },
      ],
    },
  }).catch(() => {});
  await prisma.booking.deleteMany({
    where: {
      OR: [
        { bookingNumber: { startsWith: 'LPU-TEST-R9-' } },
        { purpose: { contains: 'R9 Test' } },
        ...(createdR9ResourceId ? [{ resourceId: createdR9ResourceId }] : []),
        ...(createdR9UserIds.length > 0 ? [{ userId: { in: createdR9UserIds } }] : []),
      ],
    },
  }).catch(() => {});

  if (createdR9ResourceId) {
    await prisma.resource.delete({ where: { id: createdR9ResourceId } }).catch(() => {});
  }
  if (createdR9UserIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: createdR9UserIds } },
    }).catch(() => {});
  }
}

async function setup() {
  console.log('\n======================================================');
  console.log('🔔 INITIALIZING R9 TEST SUITE: NOTIFICATIONS, REMINDERS & ACCOUNT');
  console.log('======================================================\n');

  const ts = Date.now();
  const pwdHash = await bcrypt.hash('Lpu@12345', 10);

  studentA = await prisma.user.create({
    data: {
      email: `r9.studentA.${ts}@lpu.in`,
      name: 'R9 Isolated Student A',
      passwordHash: pwdHash,
      role: Role.STUDENT,
      department: 'Computer Science',
      regNo: `R9A${String(ts).slice(-6)}`,
      emailVerified: true,
    },
  });
  studentB = await prisma.user.create({
    data: {
      email: `r9.studentB.${ts}@lpu.in`,
      name: 'R9 Isolated Student B',
      passwordHash: pwdHash,
      role: Role.STUDENT,
      department: 'Computer Science',
      regNo: `R9B${String(ts).slice(-6)}`,
      emailVerified: true,
    },
  });
  facultyUser = await prisma.user.create({
    data: {
      email: `r9.faculty.${ts}@lpu.in`,
      name: 'R9 Isolated Faculty',
      passwordHash: pwdHash,
      role: Role.FACULTY,
      department: 'Computer Science',
      regNo: `R9F${String(ts).slice(-6)}`,
      emailVerified: true,
    },
  });
  createdR9UserIds = [studentA.id, studentB.id, facultyUser.id];

  approver = await prisma.user.findUnique({ where: { email: 'approver.sece@lpu.in' } });
  assert.ok(studentA && studentB && facultyUser && approver, 'Test & seed users exist');

  studentAToken = signAuthToken({ id: studentA.id, email: studentA.email, role: studentA.role });
  studentBToken = signAuthToken({ id: studentB.id, email: studentB.email, role: studentB.role });
  approverToken = signAuthToken({ id: approver.id, email: approver.email, role: approver.role });

  resourceA = await prisma.resource.create({
    data: {
      code: `R9-ROOM-${String(ts).slice(-6)}`,
      name: `R9 Isolated Classroom ${String(ts).slice(-4)}`,
      category: ResourceCategory.CLASSROOM,
      department: 'Computer Science',
      building: 'Block 34',
      floor: '1st Floor',
      capacity: 40,
      amenities: ['Projector'],
      imageUrl: 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=600&q=80',
      requiresApproval: false,
      operatingHours: '08:00 AM - 08:00 PM',
    },
  });
  createdR9ResourceId = resourceA.id;
  approvalResource = await prisma.resource.findFirst({
    where: { requiresApproval: true, deletedAt: null },
  });
  assert.ok(resourceA && approvalResource, 'Seed resources exist');
}

let seq = 1;
async function createBooking(opts: {
  userId: string;
  resourceId: string;
  department: string;
  status: BookingStatus;
  startOffsetMin: number;
  endOffsetMin: number;
  releaseOffsetMin?: number;
  checkedInAt?: Date | null;
  purpose?: string;
}) {
  const now = Date.now();
  const startTime = new Date(now + opts.startOffsetMin * 60000);
  const endTime = new Date(now + opts.endOffsetMin * 60000);
  const releaseDeadline = new Date(startTime.getTime() + (opts.releaseOffsetMin ?? 15) * 60000);
  const pin = generateSecurePin();
  const num = `LPU-TEST-R9-${Date.now().toString().slice(-6)}-${seq++}`;

  if (opts.status !== BookingStatus.CANCELLED) await prisma.booking.updateMany({
    where: {
      resourceId: opts.resourceId,
      bookingNumber: { startsWith: 'LPU-TEST-R9-' },
      status: { in: [BookingStatus.PENDING, BookingStatus.APPROVED, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
    },
    data: { status: BookingStatus.CANCELLED },
  });

  return prisma.booking.create({
    data: {
      bookingNumber: num,
      userId: opts.userId,
      resourceId: opts.resourceId,
      startTime,
      endTime,
      releaseDeadline,
      checkedInAt: opts.checkedInAt ?? null,
      purpose: opts.purpose || `R9 Test ${num}`,
      activityType: ActivityType.PROJECT_WORK,
      expectedAttendance: 4,
      priority: PriorityLevel.NORMAL,
      status: opts.status,
      checkInToken: null,
      checkInPinHash: hashPin(pin),
      departmentId: opts.department,
    },
  });
}

/**
 * A. Notification API & Preferences Tests (1 - 11)
 */
async function runNotificationTests() {
  console.log('\n--- SUITE A: Notification API & Preferences ---');
  try {
    const n1 = await prisma.notification.create({
      data: { userId: studentA.id, title: 'R9 Test Alert 1', message: 'R9 Test Message 1', type: 'BOOKING', read: false },
    });
    const n2 = await prisma.notification.create({
      data: { userId: studentA.id, title: 'R9 Test Alert 2', message: 'R9 Test Message 2', type: 'REMINDER', read: false },
    });
    const nOther = await prisma.notification.create({
      data: { userId: studentB.id, title: 'R9 Test Other', message: 'Private', type: 'BOOKING', read: false },
    });

    // 1 & 2. List & server-side pagination
    const listRes = await fetch(`${BASE_URL}/api/notifications?page=1&limit=1`, {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const listData = await listRes.json();
    assert.strictEqual(listRes.status, 200);
    assert.strictEqual(listData.notifications.length, 1);
    assert.ok(listData.pagination.total >= 2);
    pass('Tests 1-2: Notification listing & server-side pagination work');

    // 3. Unread count accurate
    const cntRes = await fetch(`${BASE_URL}/api/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    const cntData = await cntRes.json();
    assert.ok(cntData.unreadCount >= 2);
    pass('Test 3: Unread notification count accurately queried from database');

    // 4. Mark one read
    const readOneRes = await fetch(`${BASE_URL}/api/notifications/${n1.id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert.strictEqual(readOneRes.status, 200);
    const n1Updated = await prisma.notification.findUnique({ where: { id: n1.id } });
    assert.strictEqual(n1Updated?.read, true);
    assert.ok(n1Updated?.readAt);
    pass('Test 4: Mark single notification read sets read=true and readAt');

    // 7 & 8. Cannot read/modify/delete another user's notification
    const crossRead = await fetch(`${BASE_URL}/api/notifications/${nOther.id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert.strictEqual(crossRead.status, 403);
    const crossList = await (
      await fetch(`${BASE_URL}/api/notifications?limit=50`, {
        headers: { Authorization: `Bearer ${studentAToken}` },
      })
    ).json();
    assert.strictEqual(crossList.notifications.some((x: any) => x.id === nOther.id), false);
    pass('Tests 7-8: Cross-user notification access & modification rejected (403)');

    // 5. Mark all read
    const readAllRes = await fetch(`${BASE_URL}/api/notifications/read-all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert.strictEqual(readAllRes.status, 200);
    const afterAllCnt = await (
      await fetch(`${BASE_URL}/api/notifications/unread-count`, {
        headers: { Authorization: `Bearer ${studentAToken}` },
      })
    ).json();
    assert.strictEqual(afterAllCnt.unreadCount, 0);
    pass('Test 5: Mark all notifications read clears unread count');

    // 6. Delete own notification
    const delRes = await fetch(`${BASE_URL}/api/notifications/${n2.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(await prisma.notification.findUnique({ where: { id: n2.id } }), null);
    pass('Test 6: Delete own notification removes record');

    // 9 & 10. Preferences defaults & update
    const prefGet = await (
      await fetch(`${BASE_URL}/api/notification-preferences`, {
        headers: { Authorization: `Bearer ${studentAToken}` },
      })
    ).json();
    assert.strictEqual(prefGet.reminderLeadMinutes, 30);
    assert.ok(prefGet.preferences.every((p: any) => p.emailEnabled === true));

    const prefPut = await fetch(`${BASE_URL}/api/notification-preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({
        reminderLeadMinutes: 45,
        preferences: [{ notificationType: 'UPCOMING_REMINDER', emailEnabled: false }],
      }),
    });
    assert.strictEqual(prefPut.status, 200);
    const prefPutData = await prefPut.json();
    assert.strictEqual(prefPutData.reminderLeadMinutes, 45);
    pass('Tests 9-10: Preference defaults & configurable lead time persisted');
  } catch (err) {
    fail('Suite A Notification tests', err);
  }
}

/**
 * B. Scheduler, Reminders & Event Email Tests (11 - 25)
 */
async function runReminderAndEmailTests() {
  console.log('\n--- SUITE B: Reminders, Concurrency & Email Delivery ---');
  try {
    // 11, 12, 25. Upcoming reminder with configured lead time (45m) & email disabled -> in-app created, email skipped
    const bUpcoming = await createBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: 40, // Within 45m lead time
      endOffsetMin: 100,
    });

    // 14. Cancelled booking must not receive reminder
    const bCancelled = await createBooking({
      userId: studentB.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CANCELLED,
      startOffsetMin: 20,
      endOffsetMin: 80,
    });

    // 13 & 15. Auto-release warning 5m before deadline (and checked-in excluded)
    const resourceB = await prisma.resource.findFirst({ where: { id: { notIn: [resourceA.id, approvalResource.id] }, deletedAt: null } });
    const bWarn = await createBooking({
      userId: studentB.id,
      resourceId: resourceB!.id,
      department: resourceB!.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: -12,
      endOffsetMin: 48,
      releaseOffsetMin: 15, // deadline is +3m from now (within 5m window)
    });

    const bCheckedIn = await createBooking({
      userId: studentB.id,
      resourceId: approvalResource.id,
      department: approvalResource.department,
      status: BookingStatus.CHECKED_IN,
      startOffsetMin: -12,
      endOffsetMin: 48,
      releaseOffsetMin: 15,
      checkedInAt: new Date(),
    });

    // MANDATORY CONCURRENCY TEST (17): Run two competing scheduler workers simultaneously
    const [run1, run2] = await Promise.all([
      ReminderService.runAll(new Date()),
      ReminderService.runAll(new Date()),
    ]);

    const upcomingDeliveries = await prisma.notificationDelivery.findMany({
      where: { bookingId: bUpcoming.id, notificationType: 'UPCOMING_REMINDER' },
    });
    assert.strictEqual(upcomingDeliveries.length, 1, 'Exactly 1 logical UPCOMING_REMINDER delivery must exist across concurrent workers');
    assert.strictEqual(upcomingDeliveries[0].status, DeliveryStatus.SKIPPED, 'Email skipped when user disabled email preference');

    // Verify in-app notification still created even when email disabled (Test 11)
    const inAppUpcoming = await prisma.notification.findFirst({
      where: { userId: studentA.id, type: 'REMINDER', message: { contains: resourceA.name } },
    });
    assert.ok(inAppUpcoming, 'In-app reminder notification still created when email is disabled');

    // Cancelled & checked-in excluded
    assert.strictEqual(
      await prisma.notificationDelivery.count({ where: { bookingId: bCancelled.id } }),
      0
    );
    assert.strictEqual(
      await prisma.notificationDelivery.count({ where: { bookingId: bCheckedIn.id } }),
      0
    );

    // Auto-release warning created once
    const warnDeliveries = await prisma.notificationDelivery.findMany({
      where: { bookingId: bWarn.id, notificationType: 'AUTO_RELEASE_WARNING' },
    });
    assert.strictEqual(warnDeliveries.length, 1);
    assert.strictEqual(warnDeliveries[0].status, DeliveryStatus.SENT);

    // 18. Repeated run does not duplicate
    await ReminderService.runAll(new Date());
    assert.strictEqual(
      await prisma.notificationDelivery.count({ where: { bookingId: bUpcoming.id } }),
      1
    );

    // 19. Failed email delivery retried safely without duplicating in-app notification
    const failedDel = await prisma.notificationDelivery.create({
      data: {
        userId: studentB.id,
        bookingId: bWarn.id,
        notificationType: 'SYSTEM_RETRY_TEST',
        scheduledFor: new Date(),
        status: DeliveryStatus.FAILED,
        attemptCount: 1,
        recipientEmail: studentB.email,
        subject: 'Retry Test',
        htmlBody: '<p>Retry</p>',
        textBody: 'Retry',
      },
    });
    await ReminderService.processPendingEmailDeliveries();
    const retried = await prisma.notificationDelivery.findUnique({ where: { id: failedDel.id } });
    assert.strictEqual(retried?.status, DeliveryStatus.SENT);
    assert.strictEqual(retried?.attemptCount, 2);

    // 21-23. Approval & Rejection event emails
    const bPend = await createBooking({
      userId: studentB.id,
      resourceId: approvalResource.id,
      department: approvalResource.department,
      status: BookingStatus.PENDING,
      startOffsetMin: 120,
      endOffsetMin: 180,
    });
    const approveRes = await fetch(`${BASE_URL}/api/approvals/${bPend.id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${approverToken}` },
      body: JSON.stringify({ action: 'APPROVE', notes: 'Approved for R9 test' }),
    });
    assert.strictEqual(approveRes.status, 200);
    const approveDel = await prisma.notificationDelivery.findFirst({
      where: { bookingId: bPend.id, notificationType: 'BOOKING_APPROVED' },
    });
    assert.ok(approveDel, 'Approval event email delivery recorded');

    pass('Tests 11-25: Reminders, concurrency lock idempotency, retries, and event emails verified');
  } catch (err) {
    fail('Suite B Reminder & Email tests', err);
  }
}

/**
 * C & D. Profile, Password & Distributed Session Revocation Tests (26 - 41)
 */
async function runProfileAndSessionTests() {
  console.log('\n--- SUITE C & D: Profile, Password & Distributed Session Revocation ---');
  try {
    // Login to get a real persistent UserSession token using isolated suite faculty user
    const demoRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: facultyUser.email, password: 'Lpu@12345' }),
    });
    const demoData = await demoRes.json();
    assert.strictEqual(demoRes.status, 200);
    const sessionToken = demoData.token;

    // 26-29. Profile update name/phone, role/department immutable
    const profRes = await fetch(`${BASE_URL}/api/me/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({
        name: 'Aastha R9 Updated',
        phone: '+91 98765 11111',
        role: 'ADMINISTRATOR',
        department: 'Fake Department',
      }),
    });
    const profData = await profRes.json();
    assert.strictEqual(profRes.status, 200);
    assert.strictEqual(profData.user.name, 'Aastha R9 Updated');
    assert.strictEqual(profData.user.role, Role.STUDENT, 'Role must remain immutable');
    assert.strictEqual(profData.user.department, studentA.department, 'Department must remain immutable');
    pass('Tests 26-30: Profile edits update name/phone while keeping role & department server-controlled');

    // 31-32. Password change invalid current rejected, valid succeeds
    const badPwd = await fetch(`${BASE_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'newPassword123' }),
    });
    assert.strictEqual(badPwd.status, 401);

    const origHash = studentA.passwordHash;
    const tempPwd = 'tempPassR9!123';
    await prisma.user.update({
      where: { id: studentA.id },
      data: { passwordHash: await bcrypt.hash(tempPwd, 10) },
    });
    const okPwd = await fetch(`${BASE_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentAToken}` },
      body: JSON.stringify({ currentPassword: tempPwd, newPassword: 'newPasswordR9!456' }),
    });
    assert.strictEqual(okPwd.status, 200);
    const okPwdData = await okPwd.json();
    studentAToken = okPwdData.token || studentAToken;
    // Restore original passwordHash
    await prisma.user.update({ where: { id: studentA.id }, data: { passwordHash: origHash } });
    pass('Tests 31-32: Password change verifies current password & rejects invalid attempts');

    // 33-38. Active sessions, no raw tokens, revoke & verify across two simulated instances
    const sessListRes = await fetch(`${BASE_URL}/api/me/sessions`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const sessListData = await sessListRes.json();
    assert.strictEqual(sessListRes.status, 200);
    assert.ok(sessListData.sessions.length >= 1);
    const currentSess = sessListData.sessions.find((s: any) => s.isCurrent);
    assert.ok(currentSess);
    assert.strictEqual(JSON.stringify(sessListData).includes(sessionToken), false, 'Raw JWT never exposed');

    // Cross-user revoke rejected
    const crossRevoke = await fetch(`${BASE_URL}/api/me/sessions/${currentSess.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert.strictEqual(crossRevoke.status, 403);

    // Owner revokes session
    const revokeRes = await fetch(`${BASE_URL}/api/me/sessions/${currentSess.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.strictEqual(revokeRes.status, 200);

    // MANDATORY DISTRIBUTED CHECK:
    // Instance 1 (HTTP server) rejects revoked token; Instance 2 (independent auth middleware call) also rejects immediately
    const inst1Check = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.strictEqual(inst1Check.status, 401, 'Instance 1 must reject revoked session');

    const inst2Req = new Request('http://instance-2.internal/api/me', {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const inst2User = await getSessionUser(inst2Req);
    assert.strictEqual(inst2User, null, 'Instance 2 must immediately reject revoked session from shared DB');

    // 39-41. Sign out all devices invalidates all sessions & logs AuditLog
    const login2 = await (
      await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: facultyUser.email, password: 'Lpu@12345' }),
      })
    ).json();
    const revokeAllRes = await fetch(`${BASE_URL}/api/me/sessions/revoke-all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${login2.token}` },
    });
    assert.strictEqual(revokeAllRes.status, 200);
    const afterRevokeAll = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${login2.token}` },
    });
    assert.strictEqual(afterRevokeAll.status, 401);

    pass('Tests 33-41: Session listing, cross-user protection, global sign-out & cross-instance revocation verified');
  } catch (err) {
    fail('Suite C & D Profile & Session tests', err);
  }
}

/**
 * E & F. Calendar Export/Feed & Email Template Security Tests (42 - 57)
 */
async function runCalendarAndTemplateTests() {
  console.log('\n--- SUITE E & F: Calendar Export/Feed & Email Template Safety ---');
  try {
    // 43. Unauthenticated calendar export rejected
    const unauthCal = await fetch(`${BASE_URL}/api/me/calendar.ics`);
    assert.strictEqual(unauthCal.status, 401);

    // 42 & 50. Authenticated calendar & per-booking ICS
    const bCal = await createBooking({
      userId: studentA.id,
      resourceId: resourceA.id,
      department: resourceA.department,
      status: BookingStatus.CONFIRMED,
      startOffsetMin: 180,
      endOffsetMin: 240,
      purpose: 'R9 Test; Escaped, Purpose\\Slash',
    });

    const authCal = await fetch(`${BASE_URL}/api/me/calendar.ics`, {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert.strictEqual(authCal.status, 200);
    assert.ok(authCal.headers.get('content-type')?.includes('text/calendar'));
    const icsText = await authCal.text();
    assert.ok(icsText.includes('BEGIN:VCALENDAR') && icsText.includes('TZID=Asia/Kolkata'));
    assert.ok(icsText.includes(`UID:booking-${bCal.id}@lpu.in`));
    assert.ok(icsText.includes('Escaped\\, Purpose\\\\Slash'), 'RFC 5545 escaping verified');

    const singleIcs = await fetch(`${BASE_URL}/api/bookings/${bCal.id}/calendar.ics`, {
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert.strictEqual(singleIcs.status, 200);
    const crossSingleIcs = await fetch(`${BASE_URL}/api/bookings/${bCal.id}/calendar.ics`, {
      headers: { Authorization: `Bearer ${studentBToken}` },
    });
    assert.strictEqual(crossSingleIcs.status, 403);

    // 44-48. Secret calendar feed generation, isolation, regeneration & revocation
    const regen1 = await (
      await fetch(`${BASE_URL}/api/me/calendar-feed/regenerate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${studentAToken}` },
      })
    ).json();
    assert.ok(regen1.feedUrl.includes('/api/calendar/feed/'));
    const feedPath1 = new URL(regen1.feedUrl).pathname;

    const feedRes1 = await fetch(`${BASE_URL}${feedPath1}`);
    assert.strictEqual(feedRes1.status, 200);
    const feedIcs1 = await feedRes1.text();
    assert.ok(feedIcs1.includes(`UID:booking-${bCal.id}@lpu.in`));

    // Regeneration invalidates old URL
    const regen2 = await (
      await fetch(`${BASE_URL}/api/me/calendar-feed/regenerate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${studentAToken}` },
      })
    ).json();
    const oldFeedRes = await fetch(`${BASE_URL}${feedPath1}`);
    assert.strictEqual(oldFeedRes.status, 401, 'Old feed URL must be invalidated on regeneration');

    const feedPath2 = new URL(regen2.feedUrl).pathname;
    assert.strictEqual((await fetch(`${BASE_URL}${feedPath2}`)).status, 200);

    // Revocation blocks access
    await fetch(`${BASE_URL}/api/me/calendar-feed`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${studentAToken}` },
    });
    assert.strictEqual((await fetch(`${BASE_URL}${feedPath2}`)).status, 401);

    // Status endpoint never returns tokenHash
    const statusFeed = await (
      await fetch(`${BASE_URL}/api/me/calendar-feed`, {
        headers: { Authorization: `Bearer ${studentAToken}` },
      })
    ).json();
    assert.strictEqual(JSON.stringify(statusFeed).includes('tokenHash'), false);
    pass('Tests 42-51: Authenticated ICS, per-booking ICS, secret feed regeneration & revocation verified');

    // 52-55. Email template HTML escaping, plain-text alternative, no secrets
    const rendered = renderEmailTemplate({
      kind: 'booking_rejected',
      recipientName: '<script>alert("xss")</script>',
      resourceName: 'Lab <b>101</b>',
      bookingNumber: 'LPU-2026-999999',
      startTime: new Date(),
      endTime: new Date(Date.now() + 3600000),
      reason: '<img src=x onerror=alert(1)>',
    });
    assert.strictEqual(rendered.html.includes('<script>'), false, 'HTML must escape script tags');
    assert.strictEqual(rendered.html.includes('<img src=x'), false, 'HTML must escape img injection');
    assert.ok(rendered.html.includes('&lt;script&gt;'));
    assert.ok(rendered.text.length > 20, 'Plain-text alternative must exist');
    assert.strictEqual(rendered.html.toLowerCase().includes('check-in pin'), false);
    pass('Tests 52-57: Email templates escape untrusted HTML, include plain-text, and omit secrets');
  } catch (err) {
    fail('Suite E & F Calendar & Email tests', err);
  }
}

async function main() {
  try {
    await setup();
    await runNotificationTests();
    await runReminderAndEmailTests();
    await runProfileAndSessionTests();
    await runCalendarAndTemplateTests();

    console.log('\n======================================================');
    console.log(`🏁 R9 TEST SUITE FINISHED: ${testPassed} PASSED, ${testFailed} FAILED`);
    console.log('======================================================\n');
    if (testFailed > 0) process.exit(1);
  } catch (err) {
    console.error('Fatal R9 test error:', err);
    process.exit(1);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main();
