import { prisma } from '@/lib/prisma';
import { ok, withErrorHandling } from '@/lib/api-response';
import { requireRole } from '@/lib/auth';
import { Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const admin = await requireRole(request, Role.ADMINISTRATOR);
    const { id } = params;
    const data = await request.json().catch(() => ({}));

    const resource = await prisma.resource.update({
      where: { id },
      data: {
        name: data.name,
        capacity: data.capacity !== undefined ? Number(data.capacity) : undefined,
        amenities: data.amenities,
        isUnderMaintenance:
          data.isUnderMaintenance !== undefined ? Boolean(data.isUnderMaintenance) : undefined,
        maintenanceReason: data.maintenanceReason,
        requiresApproval:
          data.requiresApproval !== undefined ? Boolean(data.requiresApproval) : undefined,
        operatingHours: data.operatingHours,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'RESOURCE_UPDATED',
        userId: admin.id,
        entityType: 'Resource',
        entityId: resource.id,
        details: `Updated resource ${resource.name}. Maintenance mode: ${resource.isUnderMaintenance}`,
      },
    });

    return ok({ resource, message: 'Resource updated successfully.' });
  }
);

export const DELETE = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    await requireRole(request, Role.ADMINISTRATOR);
    const { id } = params;

    const resource = await prisma.resource.delete({
      where: { id },
    });

    return ok({ message: `Resource ${resource.name} deleted successfully.` });
  }
);
