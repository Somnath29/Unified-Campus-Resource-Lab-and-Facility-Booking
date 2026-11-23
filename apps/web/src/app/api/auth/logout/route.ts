import { cookies } from 'next/headers';
import { ok, withErrorHandling } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async () => {
  const cookieStore = cookies();
  cookieStore.delete('token');
  cookieStore.delete('lpu_session');

  return ok({
    success: true,
    message: 'Logged out successfully.',
  });
});
