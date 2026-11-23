import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { signToken } from '@/lib/auth';
import { env } from '@/lib/env';
import { ok, fail, withErrorHandling } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request: Request) => {
  // Requirement: auth/demo-login must exist only when ENABLE_DEMO_LOGIN=true and NODE_ENV is not "production"
  if (!env.ENABLE_DEMO_LOGIN || env.NODE_ENV === 'production') {
    return fail(404, 'Demo login endpoint is disabled.');
  }

  const body = await request.json();
  const { role } = body;

  let targetEmail = 'ketan.12204598@lpu.in';
  if (role === 'FACULTY') {
    targetEmail = 'arvind.cse@lpu.in';
  } else if (role === 'DEPARTMENT_APPROVER') {
    targetEmail = 'approver.sece@lpu.in';
  } else if (role === 'ADMINISTRATOR') {
    targetEmail = 'admin.estate@lpu.in';
  } else if (role === 'STUDENT') {
    targetEmail = 'ketan.12204598@lpu.in';
  }

  const user = await prisma.user.findUnique({
    where: { email: targetEmail },
  });

  if (!user) {
    return fail(404, `Demo user for role ${role} not found. Please run seed.`);
  }

  const token = signToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  // Set httpOnly cookie
  cookies().set('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });

  const { passwordHash: _, ...userWithoutPassword } = user;

  return ok({
    token,
    user: userWithoutPassword,
  });
});
