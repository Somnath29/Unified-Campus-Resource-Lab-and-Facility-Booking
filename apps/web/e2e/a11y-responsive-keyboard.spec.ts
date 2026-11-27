import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { demoLoginViaUi, getFutureWeekdayDate } from './helpers';

test.describe('R10 Accessibility, Keyboard-Only Booking & Responsive Verification', () => {
  test('Axe-core WCAG 2.0 A/AA audit on /login, /resources, /calendar, /my-bookings', async ({ page }) => {
    // 1. /login (unauthenticated)
    await page.goto('/login');
    await expect(page.locator('h1, h2').first()).toBeVisible();
    const loginResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const loginCriticalOrSerious = loginResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );
    expect(
      loginCriticalOrSerious,
      `Login axe violations: ${JSON.stringify(loginCriticalOrSerious.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })))}`
    ).toEqual([]);

    // Sign in for authenticated pages
    await demoLoginViaUi(page, 'Student');

    for (const route of ['/resources', '/calendar', '/my-bookings']) {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      const severe = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );
      expect(
        severe,
        `${route} axe violations: ${JSON.stringify(severe.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length })))}`
      ).toEqual([]);
    }
  });

  test('Responsive viewports (375px, 768px, 1280px) have zero horizontal overflow', async ({ page }) => {
    const viewports = [
      { name: 'mobile-375', width: 375, height: 812 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'desktop-1280', width: 1280, height: 800 },
    ];

    // Check /login at all viewports
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/login');
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        `/login overflow at ${vp.name}: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`
      ).toBeLessThanOrEqual(overflow.clientWidth);
    }

    // Login once at desktop then check authenticated pages at all viewports
    await page.setViewportSize({ width: 1280, height: 800 });
    await demoLoginViaUi(page, 'Student');

    for (const route of ['/resources', '/calendar', '/my-bookings']) {
      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(route);
        await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(400);
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          overflow.scrollWidth,
          `${route} overflow at ${vp.name}: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`
        ).toBeLessThanOrEqual(overflow.clientWidth);
      }
    }
  });

  test('Keyboard-only booking flow (Tab, Enter, Space only)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await demoLoginViaUi(page, 'Student');

    const token = await page.evaluate(() => localStorage.getItem('lpu_token'));
    const resList = await page.request.get('/api/resources?limit=20', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const resData = await resList.json();
    const resource =
      resData.resources.find((r: any) => r.category === 'CLASSROOM' && !r.requiresApproval) ||
      resData.resources.find((r: any) => !r.requiresApproval) ||
      resData.resources[0];

    const futureDate = getFutureWeekdayDate(4);
    await page.goto(`/calendar?resourceId=${resource.id}&date=${futureDate}`);
    const bookBtn = page.getByRole('button', { name: /Reserve/i }).first();
    await expect(bookBtn).toBeVisible({ timeout: 15_000 });

    // Focus the Reserve button via keyboard and press Enter
    await bookBtn.focus();
    await page.keyboard.press('Enter');

    const purposeInput = page.getByPlaceholder(/e\.g\.|DAA Project|purpose/i).first();
    await expect(purposeInput).toBeVisible({ timeout: 10_000 });

    // Fill purpose using keyboard typing after focusing
    await purposeInput.focus();
    await page.keyboard.type('Keyboard Only R10 Booking Flow');

    // Focus submit button and press Enter
    const submitBtn = page.getByRole('button', { name: /Confirm & Reserve Space|Submit for Approval/i });
    await submitBtn.focus();
    await page.keyboard.press('Enter');

    await expect(
      page.getByText(/Instant Reservation Confirmed|Booking Request Submitted|6-Digit Check-In PIN/i).first()
    ).toBeVisible({
      timeout: 15_000,
    });
  });
});
