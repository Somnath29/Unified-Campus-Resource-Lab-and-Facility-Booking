import { prisma } from '@/lib/prisma';
import { ok, withErrorHandling } from '@/lib/api-response';
import { requireRole } from '@/lib/auth';
import { Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  await requireRole(request, Role.ADMINISTRATOR);

  const policies = await prisma.departmentPolicy.findMany();
  return ok({ policies });
});
