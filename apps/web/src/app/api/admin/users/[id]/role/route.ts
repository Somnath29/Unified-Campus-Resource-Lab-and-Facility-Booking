import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireRole } from '@/lib/auth';
import { Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const admin = await requireRole(request, Role.ADMINISTRATOR);
    const { id } = params;
    const body = await request.json().catch(() => ({}));
    const { role } = body;

    if (!role || !Object.values(Role).includes(role)) {
      return fail(400, 'Invalid user role provided.');
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, name: true, email: true, role: true },
    });

    await prisma.auditLog.create({
      data: {
        action: 'USER_ROLE_UPDATED',
        userId: admin.id,
        entityType: 'User',
        entityId: id,
        details: `Updated role of ${updated.name} to ${role}`,
      },
    });

    return ok({ user: updated, message: 'User role updated successfully.' });
  }
);
