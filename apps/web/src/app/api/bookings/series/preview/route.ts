import { ok, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { SeriesBookingService } from '@/services/seriesBookingService';
import { BookingSeriesPreviewRequest } from '@lpu/shared';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const seriesPreviewSchema = z.object({
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
  activityType: z.string().optional(),
  purpose: z.string().optional(),
});

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const data = seriesPreviewSchema.parse(body) as unknown as BookingSeriesPreviewRequest;

  const result = await SeriesBookingService.previewSeries(user, data);

  return ok(result);
});
