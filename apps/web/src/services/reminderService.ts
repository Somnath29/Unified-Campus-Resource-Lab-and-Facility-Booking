import { prisma } from '@/lib/prisma';
import { BookingStatus, DeliveryStatus } from '@prisma/client';
import { EmailService } from '@/services/emailService';
import { EmailTemplateKind, renderEmailTemplate } from '@/lib/email-templates';
import { formatKolkataDate, formatKolkataTime } from '@/lib/timezone';
import {
  NOTIFICATION_PREFERENCE_CATEGORIES,
  NotificationPreferenceCategory,
  ReminderJobResponse,
} from '@lpu/shared';

export const NOTIFICATION_CATEGORY_META: Record<
  NotificationPreferenceCategory,
  { label: string; description: string }
> = {
  BOOKING_CONFIRMED: {
    label: 'Booking Confirmed',
    description: 'When a new reservation is automatically confirmed.',
  },
  BOOKING_APPROVED: {
    label: 'Booking Approved',
    description: 'When a department approver approves your pending request.',
  },
  BOOKING_REJECTED: {
    label: 'Booking Declined',
    description: 'When a reservation request is declined by an approver.',
  },
  BOOKING_CANCELLED: {
    label: 'Booking Cancelled',
    description: 'When you or staff cancel an upcoming reservation.',
  },
  BOOKING_RESCHEDULED: {
    label: 'Booking Rescheduled',
    description: 'When a reservation time or resource is updated.',
  },
  UPCOMING_REMINDER: {
    label: 'Upcoming Booking Reminder',
    description: 'Scheduled reminder before your session starts.',
  },
  AUTO_RELEASE_WARNING: {
    label: 'Auto-Release Warning',
    description: 'Urgent warning 5 minutes before check-in release deadline.',
  },
  WAITLIST_OFFER: {
    label: 'Waitlist Slot Offer',
    description: 'When a waitlisted time slot opens up for 15 minutes.',
  },
  WAITLIST_EXPIRED: {
    label: 'Waitlist Offer Expired',
    description: 'When an unaccepted waitlist offer expires.',
  },
  BOOKING_COMPLETED: {
    label: 'Booking Completed',
    description: 'When your session ends or completes automatically.',
  },
  SYSTEM: {
    label: 'System Updates',
    description: 'General platform notices and announcements.',
  },
};

export const DEFAULT_REMINDER_LEAD_MINUTES = 30;
export const MIN_REMINDER_LEAD_MINUTES = 5;
export const MAX_REMINDER_LEAD_MINUTES = 1440;
const AUTO_RELEASE_WARNING_LEAD_MS = 5 * 60 * 1000;
const MAX_EMAIL_RETRIES = 3;

export async function getUserNotificationPreferences(userId: string) {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId },
  });
  const byType = new Map(rows.map((r) => [r.notificationType, r]));

  const reminderPref = byType.get('UPCOMING_REMINDER');
  const reminderLeadMinutes = reminderPref?.reminderLeadMinutes ?? DEFAULT_REMINDER_LEAD_MINUTES;

  const preferences = NOTIFICATION_PREFERENCE_CATEGORIES.map((category) => {
    const existing = byType.get(category);
    const meta = NOTIFICATION_CATEGORY_META[category];
    return {
      notificationType: category,
      label: meta.label,
      description: meta.description,
      emailEnabled: existing ? existing.emailEnabled : true,
      reminderLeadMinutes: existing?.reminderLeadMinutes ?? reminderLeadMinutes,
    };
  });

  return { preferences, reminderLeadMinutes };
}

export async function isEmailEnabledForUser(
  userId: string,
  notificationType: NotificationPreferenceCategory
): Promise<boolean> {
  const pref = await prisma.notificationPreference.findUnique({
    where: {
      userId_notificationType: {
        userId,
        notificationType,
      },
    },
    select: { emailEnabled: true },
  });
  return pref ? pref.emailEnabled : true;
}

/**
 * Dispatches an event-driven email using a durable NotificationDelivery outbox record.
 * Never creates duplicate logical deliveries when retried.
 */
export async function dispatchEventEmail(params: {
  userId: string;
  userEmail: string;
  userName: string;
  bookingId?: string;
  notificationType: NotificationPreferenceCategory | 'SECURITY_ALERT';
  templateKind: EmailTemplateKind;
  scheduledFor?: Date;
  resourceName?: string;
  building?: string;
  bookingNumber?: string;
  startTime?: Date | string;
  endTime?: Date | string;
  releaseDeadline?: Date | string | null;
  reason?: string | null;
  actionPath?: string;
  securityDetail?: string;
}): Promise<void> {
  // Security alerts are system-critical and independent of optional email preferences
  if (params.notificationType !== 'SECURITY_ALERT') {
    const enabled = await isEmailEnabledForUser(params.userId, params.notificationType);
    if (!enabled) return;
  }

  const rendered = renderEmailTemplate({
    kind: params.templateKind,
    recipientName: params.userName,
    resourceName: params.resourceName,
    building: params.building,
    bookingNumber: params.bookingNumber,
    startTime: params.startTime,
    endTime: params.endTime,
    releaseDeadline: params.releaseDeadline,
    reason: params.reason,
    actionPath: params.actionPath,
    securityDetail: params.securityDetail,
  });

  const scheduledFor = params.scheduledFor || new Date();

  let deliveryId: string | null = null;
  try {
    const created = await prisma.notificationDelivery.create({
      data: {
        userId: params.userId,
        bookingId: params.bookingId || null,
        notificationType: params.notificationType,
        scheduledFor,
        status: DeliveryStatus.PENDING,
        recipientEmail: params.userEmail,
        subject: rendered.subject,
        htmlBody: rendered.html,
        textBody: rendered.text,
      },
    });
    deliveryId = created.id;
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return; // Duplicate logical delivery already claimed
    }
    throw err;
  }

  // Send outside any long DB transaction
  const sendRes = await EmailService.send({
    to: params.userEmail,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  await prisma.notificationDelivery.update({
    where: { id: deliveryId },
    data: {
      attemptCount: { increment: 1 },
      status: sendRes.accepted ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
      sentAt: sendRes.accepted ? new Date() : null,
      lastError: sendRes.accepted ? null : sendRes.error || 'Delivery failed',
    },
  });
}

export class ReminderService {
  /**
   * Claims and processes upcoming booking reminders using PostgreSQL advisory locks
   * and NotificationDelivery unique idempotency constraints.
   */
  static async processUpcomingReminders(now = new Date()): Promise<{
    processed: number;
    sent: number;
  }> {
    const maxLeadMs = MAX_REMINDER_LEAD_MINUTES * 60 * 1000;
    const windowEnd = new Date(now.getTime() + maxLeadMs);

    const candidates = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        startTime: {
          gt: now,
          lte: windowEnd,
        },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        resource: { select: { id: true, name: true, building: true } },
      },
      take: 100,
    });

    let processed = 0;
    let sent = 0;

    for (const booking of candidates) {
      const pref = await prisma.notificationPreference.findUnique({
        where: {
          userId_notificationType: {
            userId: booking.userId,
            notificationType: 'UPCOMING_REMINDER',
          },
        },
      });
      const leadMinutes = pref?.reminderLeadMinutes ?? DEFAULT_REMINDER_LEAD_MINUTES;
      const emailEnabled = pref ? pref.emailEnabled : true;
      const reminderDueAt = new Date(booking.startTime.getTime() - leadMinutes * 60 * 1000);

      if (now < reminderDueAt) {
        continue;
      }

      processed++;
      const lockKey = `reminder_upcoming_${booking.id}_${booking.startTime.toISOString()}`;
      const rendered = renderEmailTemplate({
        kind: 'upcoming_reminder',
        recipientName: booking.user.name,
        resourceName: booking.resource.name,
        building: booking.resource.building,
        bookingNumber: booking.bookingNumber,
        startTime: booking.startTime,
        endTime: booking.endTime,
        actionPath: '/my-bookings?tab=UPCOMING',
      });

      let claimedDeliveryId: string | null = null;

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

        // Revalidate booking eligibility inside lock
        const fresh = await tx.booking.findUnique({
          where: { id: booking.id },
          select: { status: true, startTime: true },
        });
        if (!fresh || fresh.status !== BookingStatus.CONFIRMED || fresh.startTime <= now) {
          return;
        }

        const existing = await tx.notificationDelivery.findUnique({
          where: {
            bookingId_notificationType_scheduledFor: {
              bookingId: booking.id,
              notificationType: 'UPCOMING_REMINDER',
              scheduledFor: fresh.startTime,
            },
          },
        });
        if (existing) {
          return; // Already claimed/sent
        }

        const delivery = await tx.notificationDelivery.create({
          data: {
            userId: booking.userId,
            bookingId: booking.id,
            notificationType: 'UPCOMING_REMINDER',
            scheduledFor: fresh.startTime,
            status: emailEnabled ? DeliveryStatus.PENDING : DeliveryStatus.SKIPPED,
            recipientEmail: booking.user.email,
            subject: rendered.subject,
            htmlBody: rendered.html,
            textBody: rendered.text,
          },
        });

        // Always create in-app notification independent of email preferences
        await tx.notification.create({
          data: {
            userId: booking.userId,
            title: `Upcoming Booking: ${booking.resource.name}`,
            message: `Reminder: ${booking.resource.name} on ${formatKolkataDate(fresh.startTime)} (${formatKolkataTime(fresh.startTime)} – ${formatKolkataTime(booking.endTime)} IST).`,
            type: 'REMINDER',
            link: '/my-bookings?tab=UPCOMING',
          },
        });

        if (emailEnabled) {
          claimedDeliveryId = delivery.id;
        } else {
          sent++;
        }
      });

      if (claimedDeliveryId) {
        const res = await EmailService.send({
          to: booking.user.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });

        await prisma.notificationDelivery.update({
          where: { id: claimedDeliveryId },
          data: {
            attemptCount: { increment: 1 },
            status: res.accepted ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
            sentAt: res.accepted ? new Date() : null,
            lastError: res.accepted ? null : res.error || 'Email delivery failed',
          },
        });

        if (res.accepted) sent++;
      }
    }

    return { processed, sent };
  }

  /**
   * Sends warnings 5 minutes before the R6 releaseDeadline for unchecked-in CONFIRMED bookings.
   */
  static async processAutoReleaseWarnings(now = new Date()): Promise<{
    processed: number;
    sent: number;
  }> {
    const windowEnd = new Date(now.getTime() + AUTO_RELEASE_WARNING_LEAD_MS);

    const candidates = await prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        checkedInAt: null,
        releaseDeadline: {
          gt: now,
          lte: windowEnd,
        },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        resource: { select: { id: true, name: true, building: true } },
      },
      take: 100,
    });

    let processed = 0;
    let sent = 0;

    for (const booking of candidates) {
      if (!booking.releaseDeadline) continue;
      processed++;

      const lockKey = `reminder_autorelease_${booking.id}_${booking.releaseDeadline.toISOString()}`;
      const emailEnabled = await isEmailEnabledForUser(booking.userId, 'AUTO_RELEASE_WARNING');

      const rendered = renderEmailTemplate({
        kind: 'auto_release_warning',
        recipientName: booking.user.name,
        resourceName: booking.resource.name,
        building: booking.resource.building,
        bookingNumber: booking.bookingNumber,
        startTime: booking.startTime,
        endTime: booking.endTime,
        releaseDeadline: booking.releaseDeadline,
        actionPath: '/',
      });

      let claimedDeliveryId: string | null = null;

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

        const fresh = await tx.booking.findUnique({
          where: { id: booking.id },
          select: { status: true, checkedInAt: true, releaseDeadline: true },
        });
        if (
          !fresh ||
          fresh.status !== BookingStatus.CONFIRMED ||
          fresh.checkedInAt !== null ||
          !fresh.releaseDeadline ||
          fresh.releaseDeadline <= now
        ) {
          return;
        }

        const existing = await tx.notificationDelivery.findUnique({
          where: {
            bookingId_notificationType_scheduledFor: {
              bookingId: booking.id,
              notificationType: 'AUTO_RELEASE_WARNING',
              scheduledFor: fresh.releaseDeadline,
            },
          },
        });
        if (existing) return;

        const delivery = await tx.notificationDelivery.create({
          data: {
            userId: booking.userId,
            bookingId: booking.id,
            notificationType: 'AUTO_RELEASE_WARNING',
            scheduledFor: fresh.releaseDeadline,
            status: emailEnabled ? DeliveryStatus.PENDING : DeliveryStatus.SKIPPED,
            recipientEmail: booking.user.email,
            subject: rendered.subject,
            htmlBody: rendered.html,
            textBody: rendered.text,
          },
        });

        await tx.notification.create({
          data: {
            userId: booking.userId,
            title: `Check-In Warning: ${booking.resource.name}`,
            message: `Check in before ${formatKolkataTime(fresh.releaseDeadline)} IST or booking #${booking.bookingNumber} will be auto-released as NO_SHOW.`,
            type: 'CHECKIN',
            link: '/',
          },
        });

        if (emailEnabled) {
          claimedDeliveryId = delivery.id;
        } else {
          sent++;
        }
      });

      if (claimedDeliveryId) {
        const res = await EmailService.send({
          to: booking.user.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });

        await prisma.notificationDelivery.update({
          where: { id: claimedDeliveryId },
          data: {
            attemptCount: { increment: 1 },
            status: res.accepted ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
            sentAt: res.accepted ? new Date() : null,
            lastError: res.accepted ? null : res.error || 'Email delivery failed',
          },
        });

        if (res.accepted) sent++;
      }
    }

    return { processed, sent };
  }

  /**
   * Retries pending or failed email deliveries with bounded attempts,
   * without ever duplicating in-app notifications.
   */
  static async processPendingEmailDeliveries(): Promise<{
    processed: number;
    sent: number;
  }> {
    const pending = await prisma.notificationDelivery.findMany({
      where: {
        status: { in: [DeliveryStatus.PENDING, DeliveryStatus.FAILED] },
        attemptCount: { lt: MAX_EMAIL_RETRIES },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    let processed = 0;
    let sent = 0;

    for (const delivery of pending) {
      if (!delivery.recipientEmail || !delivery.subject || !delivery.htmlBody || !delivery.textBody) {
        continue;
      }
      processed++;

      const res = await EmailService.send({
        to: delivery.recipientEmail,
        subject: delivery.subject,
        html: delivery.htmlBody,
        text: delivery.textBody,
      });

      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          attemptCount: { increment: 1 },
          status: res.accepted ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
          sentAt: res.accepted ? new Date() : null,
          lastError: res.accepted ? null : res.error || 'Email retry failed',
        },
      });

      if (res.accepted) sent++;
    }

    return { processed, sent };
  }

  static async runAll(now = new Date()): Promise<ReminderJobResponse> {
    const upcoming = await ReminderService.processUpcomingReminders(now);
    const autoRelease = await ReminderService.processAutoReleaseWarnings(now);
    const retries = await ReminderService.processPendingEmailDeliveries();

    return {
      upcomingProcessed: upcoming.processed,
      upcomingSent: upcoming.sent,
      autoReleaseProcessed: autoRelease.processed,
      autoReleaseSent: autoRelease.sent,
      retriesProcessed: retries.processed,
      retriesSent: retries.sent,
      message: `Processed ${upcoming.processed} upcoming reminders, ${autoRelease.processed} auto-release warnings, and ${retries.processed} email retries.`,
    };
  }
}
