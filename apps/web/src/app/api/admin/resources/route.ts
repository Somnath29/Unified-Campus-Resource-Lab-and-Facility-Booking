import { prisma } from '@/lib/prisma';
import { created, withErrorHandling } from '@/lib/api-response';
import { requireRole } from '@/lib/auth';
import { Role, ResourceCategory } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request: Request) => {
  const admin = await requireRole(request, Role.ADMINISTRATOR);
  const data = await request.json().catch(() => ({}));

  const resource = await prisma.resource.create({
    data: {
      code: data.code,
      name: data.name,
      category: data.category as ResourceCategory,
      department: data.department || 'Central Academic Facilities',
      building: data.building,
      floor: data.floor,
      capacity: Number(data.capacity) || 30,
      amenities: Array.isArray(data.amenities) ? data.amenities : [],
      imageUrl:
        data.imageUrl ||
        'https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=600&q=80',
      requiresApproval: Boolean(data.requiresApproval),
      isAvailableNow: true,
      isUnderMaintenance: false,
      operatingHours: data.operatingHours || '08:00 AM - 08:00 PM',
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'RESOURCE_CREATED',
      userId: admin.id,
      entityType: 'Resource',
      entityId: resource.id,
      details: `Created new resource ${resource.name} (${resource.code})`,
    },
  });

  return created({ resource, message: 'Resource created successfully.' });
});
