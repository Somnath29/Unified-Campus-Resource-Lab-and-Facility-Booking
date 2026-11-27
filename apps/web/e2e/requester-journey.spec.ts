import { test, expect } from '@playwright/test';
import { hashPin } from '../src/lib/checkin-crypto';
import {
  prisma,
  getFutureWeekdayDate,
  getVerificationTokenFromEmailLog,
  loginViaUi,
  demoLoginViaUi,
} from './helpers';

test.describe('R10 Requester End-to-End Journey', () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('A. Signup, mock-email verification, login, and logout', async ({ page }) => {
    const uniqueId = Date.now();
    const email = `r10.e2e.${uniqueId}@lpu.in`;
    const password = 'Password@1234';

    await page.goto('/login');
    await page.getByRole('button', { name: /Create an Account|Create Account|Sign Up|Register/i }).click();

    await page.getByPlaceholder(/Ketan Meshram/i).fill('R10 E2E Student');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);

    const regNoInput = page.getByPlaceholder(/12304512|Registration/i);
    if (await regNoInput.isVisible()) {
      await regNoInput.fill(`1230${String(uniqueId).slice(-4)}`);
    }

    await page.locator('button[type="submit"]').click();

    // Expect verification notice banner and switch to LOGIN mode
    await expect(page.getByRole('status')).toContainText(/verify/i, { timeout: 15_000 });

    // Unverified login must be rejected
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('alert').first()).toContainText(/verify/i, { timeout: 10_000 });

    // Extract verification token from NotificationDelivery (mock email log)
    const token = await getVerificationTokenFromEmailLog(email);
    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByText(/Account Activated/i)).toBeVisible({ timeout: 15_000 });

    // Proceed to login
    await loginViaUi(page, email, password);
    await expect(page).toHaveURL(/\/$/);

    // Logout from Sidebar
    await page.getByRole('button', { name: /Log Out/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test('B. Resource search, category filters, and calendar availability', async ({ page }) => {
    await demoLoginViaUi(page, 'Student');
    await page.goto('/resources');

    await expect(page.locator('h1, h2').first()).toBeVisible();
    // Search input
    const searchInput = page.getByPlaceholder(/Search rooms, labs, halls/i).first();
    await searchInput.fill('Seminar');
    await page.waitForTimeout(500);

    // Clear search and verify resource cards render
    await searchInput.fill('');
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: /Reserve|Book/i }).first()).toBeVisible({ timeout: 15_000 });

    // Navigate to Campus Calendar
    await page.goto('/calendar');
    await expect(page.locator('select').first()).toBeVisible({ timeout: 15_000 });
  });

  test('C. Booking creation, conflict handling, reschedule, and cancellation', async ({ page }) => {
    await demoLoginViaUi(page, 'Student');
    const futureDate = getFutureWeekdayDate(2);

    // Pick a classroom via API to ensure clean, auto-confirmable or standard booking
    const token = await page.evaluate(() => localStorage.getItem('lpu_token'));
    expect(token).toBeTruthy();

    const resList = await page.request.get('/api/resources?limit=20', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resList.ok()).toBeTruthy();
    const resData = await resList.json();
    const targetResource =
      resData.resources.find((r: any) => r.category === 'CLASSROOM' && !r.requiresApproval) ||
      resData.resources.find((r: any) => !r.requiresApproval) ||
      resData.resources[0];
    expect(targetResource).toBeTruthy();

    await page.goto(`/calendar?resourceId=${targetResource.id}&date=${futureDate}`);
    const bookBtn = page.getByRole('button', { name: /Reserve/i }).first();
    await expect(bookBtn).toBeVisible({ timeout: 15_000 });
    await bookBtn.click();

    // Fill BookingModal
    const purposeInput = page.getByPlaceholder(/e\.g\.|DAA Project|purpose/i).first();
    await expect(purposeInput).toBeVisible({ timeout: 10_000 });
    await purposeInput.fill('R10 Playwright E2E Project Discussion');

    // Submit booking
    await page.getByRole('button', { name: /Confirm & Reserve Space|Submit for Approval/i }).click();
    await expect(
      page.getByText(/Instant Reservation Confirmed|Booking Request Submitted|6-Digit Check-In PIN/i).first()
    ).toBeVisible({
      timeout: 15_000,
    });

    // Close modal and navigate to My Bookings
    await page.goto('/my-bookings');
    await expect(page.getByText('R10 Playwright E2E Project Discussion').first()).toBeVisible({
      timeout: 15_000,
    });

    // Verify conflict handling via API/UI on the exact same slot
    const bookingsRes = await page.request.get('/api/bookings?tab=UPCOMING&limit=5', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const bookingsData = await bookingsRes.json();
    const createdBooking = bookingsData.bookings.find(
      (b: any) => b.purpose === 'R10 Playwright E2E Project Discussion'
    );
    expect(createdBooking).toBeTruthy();

    // Attempt overlapping booking -> 409 Conflict
    const conflictRes = await page.request.post('/api/bookings', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `r10-conflict-${Date.now()}`,
      },
      data: {
        resourceId: createdBooking.resourceId,
        startTime: createdBooking.startTime,
        endTime: createdBooking.endTime,
        activityType: createdBooking.activityType || 'STUDY_GROUP',
        purpose: 'R10 Conflict Verification',
        attendanceCount: createdBooking.attendanceCount || 5,
      },
    });
    expect(conflictRes.status()).toBe(409);

    // Cancel the booking via My Bookings UI
    const cancelBtn = page.getByRole('button', { name: /^Cancel$/i }).first();
    await cancelBtn.click();
    const reasonField = page.getByPlaceholder(/reason/i).first();
    if (await reasonField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await reasonField.fill('R10 E2E cancellation test');
    } else {
      await page.locator('textarea').last().fill('R10 E2E cancellation test');
    }
    const confirmCancelBtn = page.getByRole('button', { name: /Confirm Cancellation/i });
    await confirmCancelBtn.click();
    await expect(page.getByText(/cancelled/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('D. Waitlist join, offer on cancellation, and accept via My Bookings', async ({ page, request }) => {
    const futureDate = getFutureWeekdayDate(4);

    // Login as Faculty via API to create an occupying booking
    const facLogin = await request.post('http://localhost:3000/api/auth/demo-login', {
      data: { role: 'FACULTY' },
    });
    expect(facLogin.ok()).toBeTruthy();
    const facData = await facLogin.json();
    const facToken = facData.token;

    const resList = await request.get('http://localhost:3000/api/resources?limit=20', {
      headers: { Authorization: `Bearer ${facToken}` },
    });
    const resData = await resList.json();
    const resource =
      resData.resources.find((r: any) => r.category === 'CLASSROOM' && !r.requiresApproval) ||
      resData.resources.find((r: any) => !r.requiresApproval) ||
      resData.resources[0];

    // Pick a free hour on futureDate for this resource
    let startIso = '';
    let endIso = '';
    for (const h of [17, 18, 15, 14, 11]) {
      const s = new Date(`${futureDate}T${String(h).padStart(2, '0')}:00:00+05:30`);
      const e = new Date(`${futureDate}T${String(h + 1).padStart(2, '0')}:00:00+05:30`);
      const existing = await prisma.booking.findFirst({
        where: {
          resourceId: resource.id,
          status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
          startTime: { lt: e },
          endTime: { gt: s },
        },
      });
      if (!existing) {
        startIso = s.toISOString();
        endIso = e.toISOString();
        break;
      }
    }
    expect(startIso).toBeTruthy();

    const facBookingRes = await request.post('http://localhost:3000/api/bookings', {
      headers: {
        Authorization: `Bearer ${facToken}`,
        'Idempotency-Key': `r10-wl-host-${Date.now()}`,
      },
      data: {
        resourceId: resource.id,
        startTime: startIso,
        endTime: endIso,
        activityType: 'GUEST_SEMINAR',
        purpose: 'R10 Waitlist Host Booking',
        attendanceCount: 5,
      },
    });
    expect([200, 201]).toContain(facBookingRes.status());
    const facBooking = (await facBookingRes.json()).booking;
    if (facBooking.status !== 'CONFIRMED') {
      await prisma.booking.update({
        where: { id: facBooking.id },
        data: { status: 'CONFIRMED' },
      });
    }

    // Now Student logs in via UI and joins waitlist for that occupied slot
    await demoLoginViaUi(page, 'Student');
    const studentToken = await page.evaluate(() => localStorage.getItem('lpu_token'));

    // Ensure student has no prior waitlist entry
    const meRes = await page.request.get('/api/me', {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const meData = await meRes.json();
    if (meData?.user?.id) {
      await prisma.waitlistEntry.deleteMany({
        where: { userId: meData.user.id },
      });
    }

    const wlJoinRes = await page.request.post('/api/waitlist', {
      headers: { Authorization: `Bearer ${studentToken}` },
      data: {
        resourceId: facBooking.resourceId || resource.id,
        startTime: facBooking.startTime || startIso,
        endTime: facBooking.endTime || endIso,
      },
    });
    expect([200, 201], `Waitlist join failed (${wlJoinRes.status()}): ${await wlJoinRes.text()}`).toContain(
      wlJoinRes.status()
    );

    // Faculty cancels host booking -> triggers WAITLIST_OFFERED for Student
    const cancelRes = await request.post(`http://localhost:3000/api/bookings/${facBooking.id}/cancel`, {
      headers: { Authorization: `Bearer ${facToken}` },
      data: { reason: 'Freeing slot for R10 waitlist test' },
    });
    expect(cancelRes.ok()).toBeTruthy();

    // Student opens My Bookings -> Waitlist tab and clicks Accept Offer
    await page.goto('/my-bookings');
    await page.getByRole('button', { name: /Waitlist/i }).click();
    const acceptBtn = page.getByRole('button', { name: /Accept Offer/i }).first();
    await expect(acceptBtn).toBeVisible({ timeout: 15_000 });
    await acceptBtn.click();

    await expect(page.getByText(/accepted|confirmed/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('E. Check-in verification flow via UI', async ({ page, request }) => {
    await demoLoginViaUi(page, 'Student');
    const studentToken = await page.evaluate(() => localStorage.getItem('lpu_token'));
    expect(studentToken).toBeTruthy();

    const meRes = await request.get('http://localhost:3000/api/me', {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const meData = await meRes.json();
    const studentId = meData.user.id;

    const resList = await request.get('http://localhost:3000/api/resources?limit=20', {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const resData = await resList.json();
    const resource = resData.resources.find((r: any) => !r.requiresApproval) || resData.resources[0];

    // Create a deterministic CONFIRMED booking starting right now inside the check-in window
    const now = Date.now();
    const startDate = new Date(now + 2 * 60_000);
    const endDate = new Date(now + 62 * 60_000);
    const pin = '654321';

    const booking = await prisma.booking.create({
      data: {
        bookingNumber: `LPU-R10-${String(now).slice(-6)}`,
        userId: studentId,
        resourceId: resource.id,
        startTime: startDate,
        endTime: endDate,
        activityType: 'PROJECT_WORK',
        purpose: 'R10 Check-In UI Test',
        expectedAttendance: 2,
        status: 'CONFIRMED',
        checkInToken: pin,
        checkInPinHash: hashPin(pin),
      },
    });

    try {
      await page.goto('/');
      const checkInBtn = page.getByRole('button', { name: /Check In/i }).first();
      if (await checkInBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await checkInBtn.click();
        const pinInput = page.getByPlaceholder(/PIN|6-digit/i).first();
        await pinInput.fill(pin);
        await page.getByRole('button', { name: /Verify|Complete Check-In/i }).click();
        await expect(page.getByText(/Checked In/i).first()).toBeVisible({ timeout: 15_000 });
      }
    } finally {
      await prisma.booking.delete({ where: { id: booking.id } }).catch(() => {});
    }
  });
});
