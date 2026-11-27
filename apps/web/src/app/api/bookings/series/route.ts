import { ok, created, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { SeriesBookingService } from '@/services/seriesBookingService';
import { BookingSeriesRequest } from '@lpu/shared';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const seriesSchema = z.object({
  resourceId: z.string().uuid(),
  frequency: z.enum(['DAILY', 'WEEKLY']),
  interval: z.coerce.number().int().min(1).default(1),
  weekdays: z.array(z.string()).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  count: z.coerce.number().int().min(1).max(16).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  durationMinutes: z.coerce.number().int().min(15).max(480).optional(),
  expectedAttendance: z.coerce.number().int().positive().default(1),
  activityType: z.string().default('PROJECT_WORK'),
  purpose: z.string().min(5),
  bookingMode: z.enum(['ATOMIC', 'PARTIAL']).default('ATOMIC'),
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
});

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const idempotencyKey =
    request.headers.get('idempotency-key') || request.headers.get('x-idempotency-key');

  const body = await request.json().catch(() => ({}));
  const data = seriesSchema.parse(body) as unknown as BookingSeriesRequest;

  const result = await SeriesBookingService.createSeries({
    user,
    input: data,
    idempotencyKey,
  });

  if (result.bookingMode === 'ATOMIC' && result.successfulCount === 0) {
    return NextResponse.json(result, { status: 409 });
  }

  if (result.successfulCount > 0) {
    return created(result);
  }

  return ok(result);
});
