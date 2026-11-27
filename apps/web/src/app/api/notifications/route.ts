import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const { searchParams } = new URL(request.url);

  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));
  const skip = (page - 1) * limit;

  const readParam = searchParams.get('read');
  const typeParam = searchParams.get('type')?.trim();

  const where: Prisma.NotificationWhereInput = {
    userId: user.id,
  };

  if (readParam === 'true' || readParam === 'READ') {
    where.read = true;
  } else if (readParam === 'false' || readParam === 'UNREAD') {
    where.read = false;
  } else if (readParam && readParam !== 'ALL') {
    return fail(400, "Invalid 'read' filter. Use 'true', 'false', 'UNREAD', or 'ALL'.");
  }

  if (typeParam && typeParam !== 'ALL') {
    where.type = typeParam.toUpperCase();
  }

  const [total, notifications, unreadCount] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({
      where: {
        userId: user.id,
        read: false,
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return ok({
    notifications: notifications.map((n) => ({
      ...n,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  });
});
