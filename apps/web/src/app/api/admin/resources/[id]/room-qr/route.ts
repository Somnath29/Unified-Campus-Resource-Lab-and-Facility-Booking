import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireRole } from '@/lib/auth';
import { Role } from '@prisma/client';
import { CheckInService } from '@/services/checkInService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const actor = await requireRole(request, Role.ADMINISTRATOR, Role.DEPARTMENT_APPROVER);
    const { id } = params;

    if (!id) {
      return fail(400, 'Resource ID is required.');
    }

    const roomQr = await CheckInService.getResourceRoomQr({
      resourceId: id,
      actor,
    });

    return ok({ roomQr });
  }
);

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const actor = await requireRole(request, Role.ADMINISTRATOR, Role.DEPARTMENT_APPROVER);
    const { id } = params;

    if (!id) {
      return fail(400, 'Resource ID is required.');
    }

    const result = await CheckInService.rotateResourceRoomQr({
      resourceId: id,
      actor,
    });

    return ok(result);
  }
);
