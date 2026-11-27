import { cookies } from 'next/headers';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth, signToken } from '@/lib/auth';
import { dispatchEventEmail } from '@/services/reminderService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters long.'),
});

export const POST = withErrorHandling(async (request: Request) => {
  const sessionUser = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const parsed = changePasswordSchema.safeParse(body);

  if (!parsed.success) {
    return fail(400, parsed.error.errors[0]?.message || 'Invalid password change request.');
  }

  const { currentPassword, newPassword } = parsed.data;
  if (currentPassword === newPassword) {
    return fail(400, 'New password must be different from your current password.');
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
  });

  if (!user) {
    return fail(404, 'User not found.');
  }

  const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isCurrentValid) {
    return fail(401, 'Current password is incorrect.');
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  const now = new Date();

  const updatedUser = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        passwordChangedAt: now,
        tokenVersion: { increment: 1 },
      },
      select: { id: true, email: true, role: true, tokenVersion: true },
    });

    // Revoke all other active sessions on password change
    await tx.userSession.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
        ...(sessionUser.sessionId ? { id: { not: sessionUser.sessionId } } : {}),
      },
      data: { revokedAt: now },
    });

    await tx.notification.create({
      data: {
        userId: user.id,
        title: 'Security Alert: Password Changed',
        message: 'Your campus account password was updated. Other active sessions have been signed out.',
        type: 'SECURITY',
        link: '/profile',
      },
    });

    await tx.auditLog.create({
      data: {
        action: 'PASSWORD_CHANGED',
        userId: user.id,
        entityType: 'User',
        entityId: user.id,
        details: JSON.stringify({
          changedAt: now.toISOString(),
          revokedOtherSessions: true,
        }),
      },
    });

    return u;
  });

  // Re-issue fresh token for current session so current user stays signed in seamlessly
  const freshToken = signToken({
    id: updatedUser.id,
    email: updatedUser.email,
    role: updatedUser.role,
    sid: sessionUser.sessionId,
    tv: updatedUser.tokenVersion,
  });
  try {
    cookies().set('token', freshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });
  } catch {}

  dispatchEventEmail({
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    notificationType: 'SECURITY_ALERT',
    templateKind: 'security_alert',
    securityDetail: 'Your LPU Campus Booking password was changed and other active sessions were signed out.',
  }).catch(() => {});

  return ok({
    success: true,
    token: freshToken,
    passwordChangedAt: now.toISOString(),
    message: 'Password updated successfully.',
  });
});
