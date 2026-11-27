import { z } from 'zod';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { CheckInService } from '@/services/checkInService';
import { getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const checkInBodySchema = z
  .object({
    bookingToken: z.string().min(1).optional(),
    pin: z
      .string()
      .regex(/^\d{6}$/, 'PIN must be a 6-digit numeric code.')
      .optional(),
    venueQr: z.string().min(1).optional(),
    override: z
      .object({
        reason: z.string().trim().min(3, 'Override reason must be at least 3 characters.'),
        bypassLateWindow: z.boolean().optional(),
        bypassVenueVerification: z.boolean().optional(),
      })
      .optional(),
  })
  .refine(
    (data) => Boolean(data.bookingToken || data.pin || data.override),
    { message: 'Provide a bookingToken, 6-digit pin, or authorized override.' }
  );

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;

    if (!id) {
      return fail(400, 'Booking ID is required.');
    }

    const rawBody = await request.json().catch(() => ({}));
    const parsed = checkInBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return fail(400, parsed.error.errors[0]?.message || 'Invalid check-in request.');
    }

    const clientIp = getClientIp(request);
    const result = await CheckInService.verifyAndCheckIn({
      bookingId: id,
      actor: user,
      input: parsed.data,
      clientIp,
    });

    return ok(result);
  }
);
