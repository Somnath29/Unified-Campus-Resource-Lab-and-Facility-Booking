import env from '@/config/env';
import { formatKolkataDate, formatKolkataTime } from '@/lib/timezone';

export type EmailTemplateKind =
  | 'booking_approved'
  | 'booking_rejected'
  | 'booking_cancelled'
  | 'upcoming_reminder'
  | 'auto_release_warning'
  | 'waitlist_offer'
  | 'waitlist_expired'
  | 'security_alert';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Escapes untrusted user-controlled strings for safe HTML email rendering.
 */
export function escapeHtml(input: string | null | undefined): string {
  if (!input) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailTemplatePayload {
  kind: EmailTemplateKind;
  recipientName: string;
  resourceName?: string;
  building?: string;
  bookingNumber?: string;
  startTime?: Date | string;
  endTime?: Date | string;
  releaseDeadline?: Date | string | null;
  reason?: string | null;
  actionPath?: string;
  securityDetail?: string;
}

function buildHtmlShell(params: {
  title: string;
  accentColor: string;
  greeting: string;
  introHtml: string;
  detailsRowsHtml: string;
  ctaLabel: string;
  ctaUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#F5F5F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#292929;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#F5F5F5;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;">
          <tr>
            <td style="background-color:#292929;padding:18px 24px;border-bottom:4px solid ${params.accentColor};">
              <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#F58220;">LPU Campus Booking Platform</div>
              <div style="font-size:18px;font-weight:800;color:#FFFFFF;margin-top:4px;">${escapeHtml(params.title)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;font-size:14px;line-height:1.6;color:#374151;">
              <p style="margin:0 0 12px 0;font-weight:600;color:#111827;">${params.greeting}</p>
              <p style="margin:0 0 18px 0;">${params.introHtml}</p>
              ${
                params.detailsRowsHtml
                  ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;margin-bottom:20px;">${params.detailsRowsHtml}</table>`
                  : ''
              }
              <div style="text-align:center;margin:24px 0 8px 0;">
                <a href="${escapeHtml(params.ctaUrl)}" style="display:inline-block;background-color:${params.accentColor};color:#FFFFFF;text-decoration:none;font-weight:700;font-size:13px;padding:12px 24px;border-radius:10px;">${escapeHtml(params.ctaLabel)}</a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color:#F9FAFB;padding:14px 24px;border-top:1px solid #E5E7EB;font-size:11px;color:#6B7280;text-align:center;">
              Lovely Professional University • Campus Resource Governance<br />
              Manage your email preferences in <a href="${escapeHtml(env.APP_URL)}/profile" style="color:#1976B9;text-decoration:underline;">Account Settings</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function detailRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 14px;font-size:12px;color:#6B7280;border-bottom:1px solid #F3F4F6;width:36%;">${escapeHtml(label)}</td>
    <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#111827;border-bottom:1px solid #F3F4F6;">${escapeHtml(value)}</td>
  </tr>`;
}

/**
 * Renders responsive HTML and plain-text email content with strict HTML escaping
 * and Asia/Kolkata timestamps. Never includes PINs, tokens, or secrets.
 */
export function renderEmailTemplate(payload: EmailTemplatePayload): RenderedEmail {
  const safeName = escapeHtml(payload.recipientName || 'Campus Member');
  const greeting = `Hello ${safeName},`;
  const appBase = env.APP_URL.replace(/\/+$/, '');
  const ctaUrl = `${appBase}${payload.actionPath || '/my-bookings'}`;

  const dateStr = payload.startTime ? formatKolkataDate(payload.startTime) : '';
  const timeRange =
    payload.startTime && payload.endTime
      ? `${formatKolkataTime(payload.startTime)} – ${formatKolkataTime(payload.endTime)} IST`
      : '';

  const commonRows = [
    payload.bookingNumber ? detailRow('Reference', payload.bookingNumber) : '',
    payload.resourceName
      ? detailRow(
          'Facility',
          payload.building ? `${payload.resourceName} (${payload.building})` : payload.resourceName
        )
      : '',
    dateStr ? detailRow('Date', dateStr) : '',
    timeRange ? detailRow('Time', timeRange) : '',
  ]
    .filter(Boolean)
    .join('');

  const commonTextLines = [
    payload.bookingNumber ? `Reference: ${payload.bookingNumber}` : '',
    payload.resourceName
      ? `Facility: ${payload.resourceName}${payload.building ? ` (${payload.building})` : ''}`
      : '',
    dateStr ? `Date: ${dateStr}` : '',
    timeRange ? `Time: ${timeRange}` : '',
  ].filter(Boolean);

  switch (payload.kind) {
    case 'booking_approved': {
      const subject = `Booking Approved: ${payload.resourceName || 'Campus Resource'} (${payload.bookingNumber || ''})`;
      const intro = `Your reservation request has been approved and confirmed. Please check in at the venue within your check-in window.`;
      return {
        subject,
        html: buildHtmlShell({
          title: 'Booking Approved & Confirmed',
          accentColor: '#10B981',
          greeting,
          introHtml: intro,
          detailsRowsHtml: commonRows,
          ctaLabel: 'View My Bookings',
          ctaUrl,
        }),
        text: `${greeting}\n\n${intro}\n\n${commonTextLines.join('\n')}\n\nOpen: ${ctaUrl}`,
      };
    }

    case 'booking_rejected': {
      const subject = `Booking Declined: ${payload.resourceName || 'Campus Resource'} (${payload.bookingNumber || ''})`;
      const reasonText = payload.reason || 'Does not meet department scheduling criteria.';
      const intro = `Unfortunately, your reservation request was declined. Reason: <strong>${escapeHtml(reasonText)}</strong>`;
      return {
        subject,
        html: buildHtmlShell({
          title: 'Booking Request Declined',
          accentColor: '#EF4444',
          greeting,
          introHtml: intro,
          detailsRowsHtml: commonRows + detailRow('Reason', reasonText),
          ctaLabel: 'Browse Other Slots',
          ctaUrl: `${appBase}/resources`,
        }),
        text: `${greeting}\n\nYour reservation request was declined.\nReason: ${reasonText}\n\n${commonTextLines.join('\n')}\n\nBrowse other slots: ${appBase}/resources`,
      };
    }

    case 'booking_cancelled': {
      const subject = `Booking Cancelled: ${payload.resourceName || 'Campus Resource'} (${payload.bookingNumber || ''})`;
      const reasonText = payload.reason || 'Cancelled by requester or administrator.';
      const intro = `This reservation has been cancelled and the time slot has been released.`;
      return {
        subject,
        html: buildHtmlShell({
          title: 'Booking Cancelled',
          accentColor: '#6B7280',
          greeting,
          introHtml: intro,
          detailsRowsHtml: commonRows + detailRow('Reason', reasonText),
          ctaLabel: 'View My Bookings',
          ctaUrl,
        }),
        text: `${greeting}\n\n${intro}\nReason: ${reasonText}\n\n${commonTextLines.join('\n')}\n\nOpen: ${ctaUrl}`,
      };
    }

    case 'upcoming_reminder': {
      const subject = `Upcoming Booking Reminder: ${payload.resourceName || 'Campus Resource'}`;
      const intro = `This is a reminder that your confirmed campus reservation starts soon. Check-in opens 30 minutes before start time and requires scanning the room's venue QR.`;
      return {
        subject,
        html: buildHtmlShell({
          title: 'Upcoming Booking Reminder',
          accentColor: '#F58220',
          greeting,
          introHtml: intro,
          detailsRowsHtml: commonRows,
          ctaLabel: 'Open Check-In & Details',
          ctaUrl,
        }),
        text: `${greeting}\n\n${intro}\n\n${commonTextLines.join('\n')}\n\nOpen: ${ctaUrl}`,
      };
    }

    case 'auto_release_warning': {
      const deadlineStr = payload.releaseDeadline
        ? `${formatKolkataTime(payload.releaseDeadline)} IST`
        : 'in 5 minutes';
      const subject = `Action Required: Check In Before ${deadlineStr} (${payload.resourceName || 'Campus Resource'})`;
      const intro = `You have not checked in yet. Your reservation will be automatically marked <strong>NO_SHOW</strong> and released to waitlisted students at <strong>${escapeHtml(deadlineStr)}</strong> if check-in is not completed.`;
      return {
        subject,
        html: buildHtmlShell({
          title: 'Imminent Auto-Release Warning',
          accentColor: '#DC2626',
          greeting,
          introHtml: intro,
          detailsRowsHtml: commonRows + detailRow('Auto-Release Deadline', deadlineStr),
          ctaLabel: 'Check In Now',
          ctaUrl,
        }),
        text: `${greeting}\n\nYou have not checked in yet. Your booking will be automatically released at ${deadlineStr} if check-in is not completed.\n\n${commonTextLines.join('\n')}\n\nCheck in now: ${ctaUrl}`,
      };
    }

    case 'waitlist_offer': {
      const subject = `Slot Available (15-Min Offer): ${payload.resourceName || 'Campus Resource'}`;
      const intro = `A slot you waitlisted for has become available! You have <strong>15 minutes</strong> to accept this offer before it passes to the next person in line.`;
      return {
        subject,
        html: buildHtmlShell({
          title: 'Waitlist Slot Offered',
          accentColor: '#F58220',
          greeting,
          introHtml: intro,
          detailsRowsHtml: commonRows,
          ctaLabel: 'Accept Offer Now',
          ctaUrl: `${appBase}/my-bookings?tab=WAITLIST`,
        }),
        text: `${greeting}\n\n${intro.replace(/<[^>]+>/g, '')}\n\n${commonTextLines.join('\n')}\n\nAccept offer: ${appBase}/my-bookings?tab=WAITLIST`,
      };
    }

    case 'waitlist_expired': {
      const subject = `Waitlist Offer Expired: ${payload.resourceName || 'Campus Resource'}`;
      const intro = `Your 15-minute waitlist offer was not accepted in time and has expired. You can rejoin the waitlist anytime from the resource calendar.`;
      return {
        subject,
        html: buildHtmlShell({
          title: 'Waitlist Offer Expired',
          accentColor: '#6B7280',
          greeting,
          introHtml: intro,
          detailsRowsHtml: commonRows,
          ctaLabel: 'View Waitlist',
          ctaUrl: `${appBase}/my-bookings?tab=WAITLIST`,
        }),
        text: `${greeting}\n\n${intro}\n\n${commonTextLines.join('\n')}\n\nView waitlist: ${appBase}/my-bookings?tab=WAITLIST`,
      };
    }

    case 'security_alert': {
      const detail = payload.securityDetail || 'Your account password or active sessions were updated.';
      const subject = 'Security Alert: LPU Campus Booking Account Updated';
      const intro = `${escapeHtml(detail)} If you did not authorize this change, please contact campus IT support immediately.`;
      return {
        subject,
        html: buildHtmlShell({
          title: 'Account Security Notification',
          accentColor: '#1976B9',
          greeting,
          introHtml: intro,
          detailsRowsHtml: detailRow('Event', detail),
          ctaLabel: 'Review Account & Sessions',
          ctaUrl: `${appBase}/profile`,
        }),
        text: `${greeting}\n\n${detail}\nIf you did not authorize this change, contact campus IT support immediately.\n\nReview account: ${appBase}/profile`,
      };
    }
  }
}
