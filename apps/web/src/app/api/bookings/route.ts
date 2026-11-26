import { ok, created, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { ActivityType, PriorityLevel } from '@prisma/client';
import { z } from 'zod';
import { BookingService } from '@/services/bookingService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createBookingSchema = z.object({
  resourceId: z.string().uuid(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  purpose: z.string().min(5, 'Purpose must be at least 5 characters'),
  activityType: z.nativeEnum(ActivityType).default(ActivityType.PROJECT_WORK),
  expectedAttendance: z.number().int().positive().default(1),
  priority: z.nativeEnum(PriorityLevel).default(PriorityLevel.NORMAL),
});

export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const { searchParams } = new URL(request.url);
  const bookings = await BookingService.listBookings(user, searchParams);
  return ok({ bookings });
});

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const idempotencyKey =
    request.headers.get('idempotency-key') || request.headers.get('x-idempotency-key');

  if (!idempotencyKey) {
    return fail(400, 'Idempotency-Key header is required for booking creation.');
  }

  const body = await request.json();
  const data = createBookingSchema.parse(body);

  const result = await BookingService.createBooking({
    user,
    input: data,
    idempotencyKey,
  });

  if (result.isIdempotentReplay) {
    return ok({
      booking: result.booking,
      message: result.message,
    });
  }

  return created({
    booking: result.booking,
    message: result.message,
  });
});
