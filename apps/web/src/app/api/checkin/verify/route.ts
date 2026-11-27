import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { CheckInService } from '@/services/checkInService';
import { getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Legacy /api/checkin/verify endpoint hardened to delegate directly to CheckInService.
 * Accepts { bookingId, bookingToken?, token?, pin?, venueQr?, override? }.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const body = await request.json().catch(() => ({}));

  const bookingId = typeof body.bookingId === 'string' ? body.bookingId.trim() : '';
  if (!bookingId) {
    return fail(400, 'Booking ID is required for check-in verification.');
  }

  const rawToken = typeof body.bookingToken === 'string' ? body.bookingToken : body.token;
  const isSixDigitPin = typeof rawToken === 'string' && /^\d{6}$/.test(rawToken.trim());

  const result = await CheckInService.verifyAndCheckIn({
    bookingId,
    actor: user,
    input: {
      bookingToken: !isSixDigitPin && rawToken ? String(rawToken) : undefined,
      pin: body.pin ? String(body.pin) : isSixDigitPin ? String(rawToken).trim() : undefined,
      venueQr: typeof body.venueQr === 'string' ? body.venueQr : undefined,
      override: body.override,
    },
    clientIp: getClientIp(request),
  });

  return ok(result);
});
