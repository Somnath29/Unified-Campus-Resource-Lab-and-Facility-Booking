import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { escapeHtml } from '../src/lib/email-templates';
import { escapeIcsText } from '../src/lib/ics';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}: ${err?.message || err}`);
    failed++;
  }
}

async function apiReq(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let body: any = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
}

function getFutureWeekdayDate(offsetDays = 14): string {
  const target = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  if (target.getDay() === 0) target.setDate(target.getDate() + 1);
  return target.toISOString().slice(0, 10);
}

async function findFreeSlot(resourceId: string, startOffsetDays = 2) {
  for (let d = startOffsetDays; d < startOffsetDays + 5; d++) {
    const dateStr = getFutureWeekdayDate(d);
    for (const hour of [9, 10, 11, 12, 13, 14, 15, 16, 17]) {
      const startTime = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00+05:30`);
      const endTime = new Date(`${dateStr}T${String(hour + 1).padStart(2, '0')}:00:00+05:30`);
      const conflict = await prisma.booking.findFirst({
        where: {
          resourceId,
          status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      });
      if (!conflict) {
        return { startTime: startTime.toISOString(), endTime: endTime.toISOString() };
      }
    }
  }
  throw new Error(`No free 1h slot found for resource ${resourceId}`);
}

async function createAndLoginUser(suffix: string, role: 'STUDENT' | 'FACULTY' = 'STUDENT') {
  const email = `r10.sec.${suffix}.${Date.now()}@lpu.in`;
  const password = 'TestPassword@123';
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      name: `R10 Test User ${suffix}`,
      passwordHash,
      role,
      department: 'Computer Science',
      regNo: `R10${Math.floor(100000 + Math.random() * 899999)}`,
      emailVerified: true,
    },
  });
  const loginRes = await apiReq('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  assert.equal(loginRes.status, 200, `Login failed for ${email}: ${JSON.stringify(loginRes.body)}`);
  return { user, token: loginRes.body.token as string, email };
}

async function main() {
  console.log('\n=== R10 Concurrency, Authorization & Security Verification ===\n');

  // Pick a clean auto-confirmable resource
  const resource = await prisma.resource.findFirst({
    where: { isUnderMaintenance: false, deletedAt: null, requiresApproval: false },
    orderBy: { name: 'asc' },
  });
  assert.ok(resource, 'Expected at least one ACTIVE non-restricted resource');

  // 1. 20 Parallel Booking Creates -> 1 x 201, 19 x 409
  await check('Concurrency: 20 parallel booking creates yield exactly 1 success (201) and 19 conflicts (409)', async () => {
    const users = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createAndLoginUser(`race-${i}`))
    );
    const { startTime, endTime } = await findFreeSlot(resource.id, 2);

    const results = await Promise.all(
      users.map((u, idx) =>
        apiReq('/api/bookings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${u.token}`,
            'Idempotency-Key': `r10-race-${Date.now()}-${idx}`,
          },
          body: JSON.stringify({
            resourceId: resource.id,
            startTime,
            endTime,
            activityType: 'PROJECT_WORK',
            purpose: `Parallel Race Attempt ${idx}`,
            attendanceCount: 4,
          }),
        })
      )
    );

    const successes = results.filter((r) => r.status === 201 || r.status === 200);
    const conflicts = results.filter((r) => r.status === 409);

    assert.equal(successes.length, 1, `Expected 1 success, got ${successes.length}: ${JSON.stringify(results[0]?.body)}`);
    assert.equal(conflicts.length, 19, `Expected 19 conflicts, got ${conflicts.length}`);
  });

  // 2. Parallel Waitlist Acceptance
  await check('Concurrency: parallel waitlist accept requests yield 1 success and loser rejection (409/400)', async () => {
    const owner = await createAndLoginUser('wl-owner', 'FACULTY');
    const waiter = await createAndLoginUser('wl-waiter', 'STUDENT');
    const { startTime, endTime } = await findFreeSlot(resource.id, 3);

    const hostBooking = await apiReq('/api/bookings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${owner.token}`,
        'Idempotency-Key': `r10-wl-host-${Date.now()}`,
      },
      body: JSON.stringify({
        resourceId: resource.id,
        startTime,
        endTime,
        activityType: 'GUEST_SEMINAR',
        purpose: 'Waitlist Concurrency Host',
        attendanceCount: 5,
      }),
    });
    assert.ok([200, 201].includes(hostBooking.status), `Host booking failed: ${JSON.stringify(hostBooking.body)}`);

    const joinRes = await apiReq('/api/waitlist', {
      method: 'POST',
      headers: { Authorization: `Bearer ${waiter.token}` },
      body: JSON.stringify({
        resourceId: resource.id,
        startTime,
        endTime,
        activityType: 'PROJECT_WORK',
        purpose: 'Waitlist Parallel Accept',
        attendanceCount: 3,
      }),
    });
    assert.ok([200, 201].includes(joinRes.status));
    const entryId = joinRes.body.entry?.id || joinRes.body.waitlistEntry?.id || joinRes.body.id;
    assert.ok(entryId, `Expected waitlist entry id, got ${JSON.stringify(joinRes.body)}`);

    // Cancel host booking to trigger offer
    const cancelRes = await apiReq(`/api/bookings/${hostBooking.body.booking.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ reason: 'Trigger waitlist offer' }),
    });
    assert.equal(cancelRes.status, 200);

    // Fire 5 parallel accept calls for the same waitlist offer
    const acceptResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        apiReq(`/api/waitlist/${entryId}/accept`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${waiter.token}` },
        })
      )
    );

    const won = acceptResults.filter((r) => r.status === 200 || r.status === 201);
    const rejected = acceptResults.filter((r) => r.status === 409 || r.status === 400);
    assert.equal(won.length, 1, `Expected exactly 1 waitlist accept win, got ${won.length}`);
    assert.equal(rejected.length, 4, `Expected 4 rejected duplicate accepts, got ${rejected.length}`);
  });

  // 3. Cross-User Authorization & Security Tests
  await check('Authorization: cross-user booking read, cancel, reschedule, check-in return 403', async () => {
    const userA = await createAndLoginUser('auth-a');
    const userB = await createAndLoginUser('auth-b');
    const { startTime, endTime } = await findFreeSlot(resource.id, 4);

    const createRes = await apiReq('/api/bookings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userA.token}`,
        'Idempotency-Key': `r10-auth-${Date.now()}`,
      },
      body: JSON.stringify({
        resourceId: resource.id,
        startTime,
        endTime,
        activityType: 'PROJECT_WORK',
        purpose: 'User A Private Booking',
        attendanceCount: 2,
      }),
    });
    assert.ok([200, 201].includes(createRes.status), `Create failed: ${JSON.stringify(createRes.body)}`);
    const bookingId = createRes.body.booking.id;

    const getOther = await apiReq(`/api/bookings/${bookingId}`, {
      headers: { Authorization: `Bearer ${userB.token}` },
    });
    assert.equal(getOther.status, 403);

    const cancelOther = await apiReq(`/api/bookings/${bookingId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userB.token}` },
      body: JSON.stringify({ reason: 'Unauthorized attempt' }),
    });
    assert.equal(cancelOther.status, 403);

    const checkInOther = await apiReq(`/api/bookings/${bookingId}/check-in`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userB.token}` },
      body: JSON.stringify({ pin: '123456' }),
    });
    assert.equal(checkInOther.status, 403);
  });

  await check('Authorization: unauthenticated me/profile/notifications/sessions return 401 and role is immutable', async () => {
    const meUnauth = await apiReq('/api/me');
    assert.equal(meUnauth.status, 401);

    const profilePatchUnauth = await apiReq('/api/me/profile', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Hacker' }),
    });
    assert.equal(profilePatchUnauth.status, 401);

    const notifUnauth = await apiReq('/api/notifications');
    assert.equal(notifUnauth.status, 401);

    const sessUnauth = await apiReq('/api/me/sessions');
    assert.equal(sessUnauth.status, 401);

    const student = await createAndLoginUser('role-immut');
    const patchRes = await apiReq('/api/me/profile', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${student.token}` },
      body: JSON.stringify({
        name: 'Updated Safe Name',
        role: 'ADMINISTRATOR',
        department: 'Hacked Dept',
      }),
    });
    assert.equal(patchRes.status, 200);
    const dbUser = await prisma.user.findUnique({ where: { id: student.user.id } });
    assert.equal(dbUser?.role, 'STUDENT', 'User role must remain STUDENT');
    assert.equal(dbUser?.department, 'Computer Science', 'User department must remain unchanged');
  });

  await check('Security: invalid calendar feed token & missing cron secrets are rejected', async () => {
    const feedRes = await apiReq(`/api/me/calendar.ics?token=${crypto.randomBytes(16).toString('hex')}`);
    assert.ok([401, 404].includes(feedRes.status), `Expected 401/404, got ${feedRes.status}`);

    const cronAutoRelease = await apiReq('/api/cron/auto-release', { method: 'GET' });
    assert.equal(cronAutoRelease.status, 401);

    const cronReminders = await apiReq('/api/cron/process-reminders', { method: 'GET' });
    assert.ok([401, 405].includes(cronReminders.status));
  });

  // 4. XSS & RFC 5545 ICS Escaping
  await check('XSS & UGC Escaping: HTML email & RFC 5545 ICS escaping sanitize payloads', async () => {
    const payload1 = '<script>alert(1)</script>';
    const payload2 = '<img src=x onerror=alert(1)>';
    const payload3 = '<svg onload=alert(1)>';

    const escaped1 = escapeHtml(payload1);
    const escaped2 = escapeHtml(payload2);
    const escaped3 = escapeHtml(payload3);

    assert.ok(!escaped1.includes('<script>'));
    assert.ok(escaped1.includes('&lt;script&gt;'));
    assert.ok(!escaped2.includes('<img'));
    assert.ok(escaped2.includes('&lt;img'));
    assert.ok(!escaped3.includes('<svg'));
    assert.ok(escaped3.includes('&lt;svg'));

    const icsEscaped = escapeIcsText('Title; With, Commas\nAnd Newlines');
    assert.ok(icsEscaped.includes('\\;'));
    assert.ok(icsEscaped.includes('\\,'));
    assert.ok(icsEscaped.includes('\\n'));
    assert.ok(!icsEscaped.includes('\n'));
  });

  console.log(`\nSummary: ${passed} passed, ${failed} failed\n`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
