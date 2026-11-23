import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { signToken } from '@/lib/auth';
import { created, fail, withErrorHandling } from '@/lib/api-response';
import { Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  role: z.any().optional(), // Ignored: registration always creates a STUDENT
  regNo: z.string().optional(),
  department: z.string().default('School of Computer Science & Engineering'),
  designation: z.string().optional(),
  phone: z.string().optional(),
});

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json();
  const data = registerSchema.parse(body);

  const existing = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase() },
  });

  if (existing) {
    return fail(409, 'An account with this university email already exists.');
  }

  const passwordHash = await bcrypt.hash(data.password, 10);

  // Requirement: The register route must ignore any role in the request body and always create a STUDENT.
  const user = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      passwordHash,
      name: data.name,
      role: Role.STUDENT,
      regNo: data.regNo,
      department: data.department,
      designation: data.designation,
      phone: data.phone,
      avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(data.name)}`,
    },
  });

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

  return created({
    token,
    user: userWithoutPassword,
  });
});
