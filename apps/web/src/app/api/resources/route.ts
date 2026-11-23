import { prisma } from '@/lib/prisma';
import { ok, withErrorHandling } from '@/lib/api-response';
import { ResourceCategory, Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);

  const category = searchParams.get('category');
  const building = searchParams.get('building');
  const minCapacity = searchParams.get('minCapacity');
  const amenity = searchParams.get('amenity');
  const search = searchParams.get('search');
  const availableOnly = searchParams.get('availableOnly');
  const includeMaintenance = searchParams.get('includeMaintenance');

  const where: Prisma.ResourceWhereInput = {};

  if (category && category !== 'ALL') {
    where.category = category as ResourceCategory;
  }

  if (building && building !== 'ALL' && building !== 'All Buildings') {
    where.building = { contains: building, mode: 'insensitive' };
  }

  if (minCapacity) {
    where.capacity = { gte: parseInt(minCapacity, 10) };
  }

  if (amenity) {
    const amenitiesList = amenity.split(',').map((s) => s.trim()).filter(Boolean);
    where.amenities = { hasSome: amenitiesList };
  }

  if (search) {
    const q = search.trim();
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { code: { contains: q, mode: 'insensitive' } },
      { building: { contains: q, mode: 'insensitive' } },
      { department: { contains: q, mode: 'insensitive' } },
    ];
  }

  if (availableOnly === 'true') {
    where.isAvailableNow = true;
  }

  if (includeMaintenance !== 'true') {
    where.isUnderMaintenance = false;
  }

  const resources = await prisma.resource.findMany({
    where,
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  return ok({
    total: resources.length,
    resources,
  });
});
