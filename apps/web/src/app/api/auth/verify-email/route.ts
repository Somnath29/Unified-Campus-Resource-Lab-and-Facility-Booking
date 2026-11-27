import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const verifySchema = z.object({
  token: z.string().min(10, 'Verification token is required.'),
});

async function verifyTokenLogic(token: string) {
  const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

  const user = await prisma.user.findFirst({
    where: {
      emailVerificationTokenHash: tokenHash,
    },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      emailVerificationExpiresAt: true,
    },
  });

  if (!user) {
    return { ok: false as const, error: 'Verification link is invalid or has already been used.' };
  }

  if (user.emailVerificationExpiresAt && user.emailVerificationExpiresAt <= new Date()) {
    return { ok: false as const, error: 'Verification link has expired. Please register again or request a new link.' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
    });

    await tx.auditLog.create({
      data: {
        action: 'EMAIL_VERIFIED',
        userId: user.id,
        entityType: 'User',
        entityId: user.id,
        details: JSON.stringify({ email: user.email }),
      },
    });
  });

  return { ok: true as const, email: user.email };
}

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, parsed.error.errors[0]?.message || 'Invalid verification token.');
  }

  const res = await verifyTokenLogic(parsed.data.token);
  if (!res.ok) {
    return fail(400, res.error);
  }

  return ok({
    verified: true,
    email: res.email,
    message: 'Email verified successfully! You can now sign in.',
  });
});

export const GET = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token') || '';
  if (!token) {
    return fail(400, 'Verification token is required.');
  }

  const res = await verifyTokenLogic(token);
  if (!res.ok) {
    return fail(400, res.error);
  }

  return ok({
    verified: true,
    email: res.email,
    message: 'Email verified successfully! You can now sign in.',
  });
});
