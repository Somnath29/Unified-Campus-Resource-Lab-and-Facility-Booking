import { prisma } from '@/lib/prisma';
import { ok, withErrorHandling } from '@/lib/api-response';
import { requireRole } from '@/lib/auth';
import { Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    await requireRole(request, Role.ADMINISTRATOR);
    const { id } = params;
    const data = await request.json().catch(() => ({}));

    const updated = await prisma.departmentPolicy.update({
      where: { id },
      data: {
        maxAdvanceDays: data.maxAdvanceDays ? Number(data.maxAdvanceDays) : undefined,
        maxBookingHoursPerWeek: data.maxBookingHoursPerWeek
          ? Number(data.maxBookingHoursPerWeek)
          : undefined,
        autoReleaseMinutes: data.autoReleaseMinutes ? Number(data.autoReleaseMinutes) : undefined,
        requireFacultyEndorsement:
          data.requireFacultyEndorsement !== undefined
            ? Boolean(data.requireFacultyEndorsement)
            : undefined,
      },
    });

    return ok({ policy: updated, message: 'Department policy updated successfully.' });
  }
);
