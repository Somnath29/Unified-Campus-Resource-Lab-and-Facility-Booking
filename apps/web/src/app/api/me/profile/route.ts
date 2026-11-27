import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(100, 'Name cannot exceed 100 characters.'),
  phone: z
    .string()
    .trim()
    .regex(/^[+\d\s\-()]{7,20}$/, 'Enter a valid phone number (7–20 digits/characters).')
    .nullable()
    .optional()
    .or(z.literal('')),
});

export const PATCH = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const body = await request.json().catch(() => ({}));

  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, parsed.error.errors[0]?.message || 'Invalid profile input.');
  }

  const normalizedPhone =
    parsed.data.phone && parsed.data.phone.trim().length > 0
      ? parsed.data.phone.trim().replace(/\s+/g, ' ')
      : null;

  // Strictly update only name and phone; role and department remain server-controlled
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      name: parsed.data.name,
      phone: normalizedPhone,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      department: true,
      regNo: true,
      designation: true,
      phone: true,
      avatarUrl: true,
      passwordChangedAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'PROFILE_UPDATED',
      userId: user.id,
      entityType: 'User',
      entityId: user.id,
      details: JSON.stringify({
        updatedFields: ['name', 'phone'],
      }),
    },
  });

  return ok({
    user: {
      ...updated,
      passwordChangedAt: updated.passwordChangedAt
        ? updated.passwordChangedAt.toISOString()
        : null,
    },
    message: 'Profile updated successfully.',
  });
});
