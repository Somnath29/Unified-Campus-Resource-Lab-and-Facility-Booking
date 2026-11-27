import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import {
  DEFAULT_REMINDER_LEAD_MINUTES,
  MAX_REMINDER_LEAD_MINUTES,
  MIN_REMINDER_LEAD_MINUTES,
  getUserNotificationPreferences,
} from '@/services/reminderService';
import { NOTIFICATION_PREFERENCE_CATEGORIES } from '@lpu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updatePreferencesSchema = z.object({
  reminderLeadMinutes: z
    .number()
    .int()
    .min(
      MIN_REMINDER_LEAD_MINUTES,
      `Reminder lead time must be at least ${MIN_REMINDER_LEAD_MINUTES} minutes.`
    )
    .max(
      MAX_REMINDER_LEAD_MINUTES,
      `Reminder lead time cannot exceed ${MAX_REMINDER_LEAD_MINUTES} minutes (24 hours).`
    )
    .optional(),
  preferences: z
    .array(
      z.object({
        notificationType: z.enum(NOTIFICATION_PREFERENCE_CATEGORIES),
        emailEnabled: z.boolean(),
      })
    )
    .min(1, 'At least one preference entry is required.'),
});

export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const result = await getUserNotificationPreferences(user.id);
  return ok(result);
});

export const PUT = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const parsed = updatePreferencesSchema.safeParse(body);

  if (!parsed.success) {
    return fail(400, parsed.error.errors[0]?.message || 'Invalid notification preferences.');
  }

  const current = await getUserNotificationPreferences(user.id);
  const leadMinutes =
    parsed.data.reminderLeadMinutes ?? current.reminderLeadMinutes ?? DEFAULT_REMINDER_LEAD_MINUTES;

  await prisma.$transaction(async (tx) => {
    for (const item of parsed.data.preferences) {
      await tx.notificationPreference.upsert({
        where: {
          userId_notificationType: {
            userId: user.id,
            notificationType: item.notificationType,
          },
        },
        update: {
          emailEnabled: item.emailEnabled,
          reminderLeadMinutes: leadMinutes,
        },
        create: {
          userId: user.id,
          notificationType: item.notificationType,
          emailEnabled: item.emailEnabled,
          reminderLeadMinutes: leadMinutes,
        },
      });
    }

    // Ensure UPCOMING_REMINDER always stores the updated reminderLeadMinutes even if not in array
    await tx.notificationPreference.upsert({
      where: {
        userId_notificationType: {
          userId: user.id,
          notificationType: 'UPCOMING_REMINDER',
        },
      },
      update: {
        reminderLeadMinutes: leadMinutes,
      },
      create: {
        userId: user.id,
        notificationType: 'UPCOMING_REMINDER',
        emailEnabled: true,
        reminderLeadMinutes: leadMinutes,
      },
    });
  });

  const updated = await getUserNotificationPreferences(user.id);
  return ok({
    ...updated,
    message: 'Notification preferences saved.',
  });
});
