/**
 * RFC 5545 iCalendar (.ics) generator with proper text escaping,
 * line folding, stable UIDs, and Asia/Kolkata timezone support.
 * Never includes check-in PINs, QR secrets, or session credentials.
 */

export interface IcsBookingInput {
  id: string;
  bookingNumber: string;
  startTime: Date | string;
  endTime: Date | string;
  purpose?: string | null;
  status: string;
  resource?: {
    name?: string | null;
    building?: string | null;
    floor?: string | null;
  } | null;
}

/**
 * Escapes RFC 5545 TEXT values: backslash, semicolon, comma, and newlines.
 */
export function escapeIcsText(value: string | null | undefined): string {
  if (!value) return '';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/**
 * Folds an ICS content line at 75 octets per RFC 5545 section 3.1.
 */
export function foldIcsLine(line: string): string {
  const maxLen = 75;
  if (line.length <= maxLen) return line;
  const parts: string[] = [];
  let offset = 0;
  parts.push(line.slice(0, maxLen));
  offset = maxLen;
  while (offset < line.length) {
    parts.push(' ' + line.slice(offset, offset + maxLen - 1));
    offset += maxLen - 1;
  }
  return parts.join('\r\n');
}

function formatUtcIcs(dateInput: Date | string): string {
  return new Date(dateInput).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function formatKolkataLocalIcs(dateInput: Date | string): string {
  const d = new Date(new Date(dateInput).getTime() + 5.5 * 60 * 60 * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}`;
}

function mapBookingStatusToIcs(status: string): 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED' {
  switch (status) {
    case 'CONFIRMED':
    case 'CHECKED_IN':
    case 'COMPLETED':
      return 'CONFIRMED';
    case 'CANCELLED':
    case 'REJECTED':
    case 'NO_SHOW':
      return 'CANCELLED';
    default:
      return 'TENTATIVE';
  }
}

const ASIA_KOLKATA_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Kolkata',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0530',
  'TZOFFSETTO:+0530',
  'TZNAME:IST',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function buildVEventLines(booking: IcsBookingInput, dtStampUtc: string): string[] {
  const resourceName = booking.resource?.name || 'Campus Resource';
  const buildingParts = [booking.resource?.building, booking.resource?.floor].filter(Boolean);
  const location = buildingParts.length > 0 ? `${resourceName}, ${buildingParts.join(', ')}` : resourceName;

  const summary = `${resourceName} (${booking.bookingNumber})`;
  const description = [
    `Reference: ${booking.bookingNumber}`,
    `Status: ${booking.status}`,
    booking.purpose ? `Purpose: ${booking.purpose}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    'BEGIN:VEVENT',
    `UID:booking-${booking.id}@lpu.in`,
    `DTSTAMP:${dtStampUtc}`,
    `DTSTART;TZID=Asia/Kolkata:${formatKolkataLocalIcs(booking.startTime)}`,
    `DTEND;TZID=Asia/Kolkata:${formatKolkataLocalIcs(booking.endTime)}`,
    foldIcsLine(`SUMMARY:${escapeIcsText(summary)}`),
    foldIcsLine(`LOCATION:${escapeIcsText(location)}`),
    foldIcsLine(`DESCRIPTION:${escapeIcsText(description)}`),
    `STATUS:${mapBookingStatusToIcs(booking.status)}`,
    'END:VEVENT',
  ];
}

export function generateSingleBookingIcs(booking: IcsBookingInput): string {
  const dtStampUtc = formatUtcIcs(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LPU Campus Booking Platform//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...ASIA_KOLKATA_VTIMEZONE,
    ...buildVEventLines(booking, dtStampUtc),
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

export function generateUserCalendarIcs(bookings: IcsBookingInput[], calName = 'LPU Campus Bookings'): string {
  const dtStampUtc = formatUtcIcs(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LPU Campus Booking Platform//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldIcsLine(`X-WR-CALNAME:${escapeIcsText(calName)}`),
    'X-WR-TIMEZONE:Asia/Kolkata',
    ...ASIA_KOLKATA_VTIMEZONE,
  ];

  for (const b of bookings) {
    lines.push(...buildVEventLines(b, dtStampUtc));
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
