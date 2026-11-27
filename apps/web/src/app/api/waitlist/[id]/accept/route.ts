import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { WaitlistService } from '@/services/waitlistService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;

    if (!id) {
      return fail(400, 'Waitlist entry ID is required.');
    }

    const result = await WaitlistService.acceptOffer({ id, user });
    return ok(result);
  }
);
