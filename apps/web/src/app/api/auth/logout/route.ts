import { cookies } from 'next/headers';
import { ok, withErrorHandling } from '@/lib/api-response';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request: Request) => {
  const user = await getSessionUser(request);
  if (user?.sessionId) {
    await prisma.userSession
      .updateMany({
        where: { id: user.sessionId, userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => {});
  }

  const cookieStore = cookies();
  cookieStore.delete('token');
  cookieStore.delete('lpu_session');

  return ok({
    success: true,
    message: 'Logged out successfully.',
  });
});
