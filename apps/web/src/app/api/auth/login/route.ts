import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { signToken } from '@/lib/auth';
import { ok, fail, withErrorHandling } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
});

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json();
  const { email, password } = loginSchema.parse(body);

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    return fail(401, 'Invalid university email or password.');
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return fail(401, 'Invalid university email or password.');
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
