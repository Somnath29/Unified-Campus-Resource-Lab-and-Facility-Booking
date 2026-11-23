import { ok } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return ok({
    status: 'online',
    timestamp: new Date().toISOString(),
    service: 'LPU Campus Resource Booking API',
    version: '1.0.0',
  });
}
