import { ok, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  return ok({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
      regNo: user.regNo,
      designation: user.designation,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      passwordChangedAt: user.passwordChangedAt
        ? user.passwordChangedAt.toISOString()
        : null,
    },
  });
});
