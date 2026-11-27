# Campus Booking Platform — Manual QA & Verification Guide (R1–R10)

This guide documents end-to-end manual QA procedures for the LPU Campus Resource & Booking Platform (`apps/web` requester portal and `apps/admin` admin portal).

---

## 1. Environment & Prerequisites

1. PostgreSQL 16 running and migrated:
   ```bash
   npx prisma migrate deploy --schema=apps/web/prisma/schema.prisma
   npx prisma generate --schema=apps/web/prisma/schema.prisma
   npm run db:seed
   ```
2. Start both apps from the repo root:
   ```bash
   npm run dev -w apps/web
   npm run dev -w apps/admin
   ```
   - Requester portal: `http://localhost:3000`
   - Admin portal: `http://localhost:5174`

---

## 2. Authentication & Email Verification (R1 / R9 / R10)

1. Navigate to `/login` and click **Create an Account**.
2. Register with a valid `@lpu.in` email, name, registration number, and password.
3. **Expected:** Account creation returns `201` with a verification banner (`Please verify your @lpu.in email before signing in`) and switches to login mode.
4. Attempt to sign in before verifying:
   - **Expected:** Rejected with HTTP `403` and an inline error message.
5. In local/mock email mode, inspect the `NotificationDelivery` table (`notificationType = 'EMAIL_VERIFICATION'`) to retrieve the `/verify-email?token=...` link.
6. Visit the verification URL:
   - **Expected:** Displays **Account Activated** and **Proceed to Sign In**.
7. Sign in with the verified credentials, then click **Log Out** in the sidebar:
   - **Expected:** Redirects to `/login` and clears `lpu_token`.

---

## 3. Resource Discovery, Filtering & Calendar Availability (R2 / R3)

1. Sign in as **Student** (`Ketan Meshram`) or a verified student account.
2. Open `/resources`:
   - Test keyword search (`Seminar`, `Lab`), category chips, building dropdown, capacity min/max, and date/time availability filters.
   - Toggle **Grid** and **List** views and change **Sort** order.
3. Click **Details** on any resource card to verify amenities, capacity, and operating hours.
4. Open `/calendar`, switch resources and dates, and confirm real-time timetable blocks and existing bookings are shown.

---

## 4. Booking Lifecycle, Policy Preview, Conflicts & Recurring Series (R4 / R5 / R6)

1. Open `/calendar` or `/resources` and click **Reserve** / **Book This Resource**.
2. Fill in date, start/end time, attendance, activity type, and purpose.
3. Verify the **Policy Preview** shows auto-confirm vs approval-required status and remaining weekly quota.
4. Submit a booking:
   - **Expected:** Booking number, 6-digit check-in PIN, QR code, and `.ics` calendar export link are displayed.
5. Attempt to book the exact same resource and overlapping time slot:
   - **Expected:** Blocked with `409` conflict message and alternative slot / waitlist options.
6. On `/my-bookings`:
   - Test **Reschedule** on an upcoming booking.
   - Test **Cancel** on an upcoming booking and verify cutoff policy enforcement.
   - Test **Recurring Bookings** (`DAILY` / `WEEKLY`, `ATOMIC` / `PARTIAL` mode) and series cancellation.

---

## 5. Waitlist Management (R7)

1. Create a confirmed booking with User A for an active resource slot.
2. With User B, view the same slot on `/calendar` and join the waitlist.
3. Cancel User A's booking:
   - **Expected:** User B's waitlist entry transitions to `OFFERED` with a countdown timer and in-app/email notification.
4. With User B, open `/my-bookings` -> **Waitlist** tab and click **Accept Offer**:
   - **Expected:** Converted into a confirmed booking; duplicate accepts fail with `409`.

---

## 6. Hardened Check-In & Checkout (R8)

1. Create a confirmed booking starting within the active check-in window.
2. Open the **Check In** modal from Dashboard or `/my-bookings`.
3. Enter an incorrect PIN 5 times:
   - **Expected:** Brute-force lockout (`429` / locked state) triggers cleanly.
4. For a fresh booking, enter the valid 6-digit PIN (and QR/location verification if enabled):
   - **Expected:** Booking transitions to `CHECKED_IN`.
5. Test **End Early** and **Extend** on a checked-in booking.

---

## 7. Notifications, Reminders & Account Settings (R9)

1. Open `/notifications`, filter unread items, mark single/all as read.
2. Open `/profile`:
   - Update profile name/phone/notification preferences.
   - Verify `role` and `department` cannot be escalated via `PATCH /api/me/profile`.
   - Copy/rotate the private **Calendar Feed (`.ics`)** URL and verify an invalid token returns `401`/`404`.
   - Inspect **Active Sessions** and revoke a session.

---

## 8. Automated Verification Commands

```bash
# 1. R10 Concurrency, Authorization & Security suite
cd apps/web && npx tsx --env-file=.env test/r10-concurrency-security.test.ts

# 2. Playwright E2E, WCAG 2.0 A/AA Axe-Core, Keyboard-Only & Responsive suite
cd apps/web && npx playwright test

# 3. R1-R9 Regression Suites
cd apps/web
for t in test/booking-r1.test.ts test/resource-r2.test.ts test/frontend-r3.test.ts \
         test/booking-r4.test.ts test/recurring-r5.test.ts test/booking-lifecycle-r6.test.ts \
         test/waitlist-r7.test.ts test/checkin-r8.test.ts test/notifications-settings-r9.test.ts; do
  npx tsx --env-file=.env "$t"
done
```
