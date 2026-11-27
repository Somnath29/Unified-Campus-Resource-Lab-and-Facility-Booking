import { PrismaClient } from '@prisma/client';
import { Page, expect } from '@playwright/test';

export const prisma = new PrismaClient();

export function getFutureWeekdayDate(offsetDays = 4): string {
  const now = new Date();
  const target = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  // Avoid Sunday (0)
  if (target.getDay() === 0) {
    target.setDate(target.getDate() + 1);
  }
  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function getVerificationTokenFromEmailLog(email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const delivery = await prisma.notificationDelivery.findFirst({
      where: {
        recipientEmail: email.toLowerCase(),
        notificationType: 'EMAIL_VERIFICATION',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (delivery) {
      const bodyText = `${delivery.subject || ''} ${delivery.textBody || ''} ${delivery.htmlBody || ''}`;
      const match = bodyText.match(/token=([a-f0-9]{32,})/i);
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No EMAIL_VERIFICATION delivery found for ${email}`);
}

export async function loginViaUi(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

export async function demoLoginViaUi(page: Page, roleLabel: 'Student' | 'Faculty' | 'Approver' | 'Admin' = 'Student') {
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(roleLabel, 'i') }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
  await expect(page.locator('main')).toBeVisible();
}
