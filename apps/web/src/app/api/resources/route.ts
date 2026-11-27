import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { ResourceCategory, Prisma, BookingStatus } from '@prisma/client';
import {
  isValidDateString,
  isValidTimeString,
  kolkataToUtc,
  getDayOfWeekInKolkata,
  parseTimeToMinutes,
} from '@/lib/timezone';
import { ResourceSortField, SortOrder, PaginationMeta } from '@lpu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_SORT_FIELDS: ResourceSortField[] = [
  'name',
  'capacity',
  'category',
  'building',
  'createdAt',
];

export const GET = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);

  // 1. Pagination Parameters
  const pageParam = searchParams.get('page');
  const limitParam = searchParams.get('limit');

  let page = 1;
  let limit = 20;

  if (pageParam !== null) {
    if (!/^\d+$/.test(pageParam)) {
      return fail(400, 'Page must be a positive integer.');
    }
    page = parseInt(pageParam, 10);
    if (page < 1) {
      return fail(400, 'Page must be greater than or equal to 1.');
    }
  }

  if (limitParam !== null) {
    if (!/^\d+$/.test(limitParam)) {
      return fail(400, 'Limit must be a positive integer between 1 and 100.');
    }
    limit = parseInt(limitParam, 10);
    if (limit < 1 || limit > 100) {
      return fail(400, 'Limit must be between 1 and 100.');
    }
  }

  // 2. Sorting Parameters
  const sortByParam = searchParams.get('sortBy');
  const sortOrderParam = searchParams.get('sortOrder');

  let sortBy: ResourceSortField = 'name';
  if (sortByParam !== null) {
    const field = sortByParam.trim() as ResourceSortField;
    if (!ALLOWED_SORT_FIELDS.includes(field)) {
      return fail(
        400,
        `Invalid sortBy field '${sortByParam}'. Allowed fields: ${ALLOWED_SORT_FIELDS.join(', ')}.`
      );
    }
    sortBy = field;
  }

  let sortOrder: SortOrder = 'asc';
  if (sortOrderParam !== null) {
    const order = sortOrderParam.trim().toLowerCase();
    if (order !== 'asc' && order !== 'desc') {
      return fail(400, "Invalid sortOrder. Allowed values: 'asc', 'desc'.");
    }
    sortOrder = order as SortOrder;
  }

  // Deterministic multi-column ordering
  const orderBy: Prisma.ResourceOrderByWithRelationInput[] = [
    { [sortBy]: sortOrder },
    { id: 'asc' }, // deterministic secondary tie-breaker
  ];

  // 3. Filtering Conditions
  const where: Prisma.ResourceWhereInput = {
    deletedAt: null, // Always exclude soft-deleted records
  };

  const category = searchParams.get('category');
  if (category && category !== 'ALL') {
    if (!Object.values(ResourceCategory).includes(category as ResourceCategory)) {
      return fail(400, `Invalid category '${category}'.`);
    }
    where.category = category as ResourceCategory;
  }

  const building = searchParams.get('building');
  if (building && building !== 'ALL' && building !== 'All Buildings') {
    where.building = { contains: building.trim(), mode: 'insensitive' };
  }

  const department = searchParams.get('department');
  if (department && department !== 'ALL') {
    where.department = { contains: department.trim(), mode: 'insensitive' };
  }

  const minCapParam = searchParams.get('minCapacity');
  const maxCapParam = searchParams.get('maxCapacity');

  let minCapacity: number | undefined;
  let maxCapacity: number | undefined;

  if (minCapParam !== null) {
    if (!/^\d+$/.test(minCapParam)) {
      return fail(400, 'minCapacity must be a non-negative integer.');
    }
    minCapacity = parseInt(minCapParam, 10);
  }

  if (maxCapParam !== null) {
    if (!/^\d+$/.test(maxCapParam)) {
      return fail(400, 'maxCapacity must be a non-negative integer.');
    }
    maxCapacity = parseInt(maxCapParam, 10);
  }

  if (minCapacity !== undefined && maxCapacity !== undefined && minCapacity > maxCapacity) {
    return fail(400, 'minCapacity cannot be greater than maxCapacity.');
  }

  if (minCapacity !== undefined || maxCapacity !== undefined) {
    where.capacity = {
      ...(minCapacity !== undefined ? { gte: minCapacity } : {}),
      ...(maxCapacity !== undefined ? { lte: maxCapacity } : {}),
    };
  }

  const amenitiesParam = searchParams.get('amenities') || searchParams.get('amenity');
  if (amenitiesParam) {
    const amenitiesList = amenitiesParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (amenitiesList.length > 0) {
      // AND semantics: resource must contain every requested amenity
      where.amenities = { hasEvery: amenitiesList };
    }
  }

  const search = searchParams.get('search');
  if (search) {
    const q = search.trim();
    if (q.length > 0) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { building: { contains: q, mode: 'insensitive' } },
        { department: { contains: q, mode: 'insensitive' } },
      ];
    }
  }

  const availableOnly = searchParams.get('availableOnly');
  if (availableOnly === 'true') {
    where.isAvailableNow = true;
  }

  const includeMaintenance = searchParams.get('includeMaintenance');
  if (includeMaintenance !== 'true') {
    where.isUnderMaintenance = false;
  }

  // 4. Optional Date/Time Availability Filtering (Set-based, Zero N+1)
  const dateParam = searchParams.get('date');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

  const hasAnyAvailParam = dateParam !== null || startParam !== null || endParam !== null;

  if (hasAnyAvailParam) {
    if (!dateParam || !startParam || !endParam) {
      return fail(
        400,
        'When filtering by availability, date (YYYY-MM-DD), start (HH:mm), and end (HH:mm) parameters are all required.'
      );
    }

    if (!isValidDateString(dateParam)) {
      return fail(400, 'Invalid date format. Expected valid YYYY-MM-DD calendar date.');
    }

    if (!isValidTimeString(startParam)) {
      return fail(400, 'Invalid start time format. Expected 24-hour HH:mm.');
    }

    if (!isValidTimeString(endParam)) {
      return fail(400, 'Invalid end time format. Expected 24-hour HH:mm.');
    }

    if (startParam >= endParam) {
      return fail(400, 'Start time must be strictly before end time.');
    }

    // Convert local Asia/Kolkata date and times to UTC boundaries
    const targetStartUtc = kolkataToUtc(dateParam, startParam);
    const targetEndUtc = kolkataToUtc(dateParam, endParam);
    const dayOfWeekKolkata = getDayOfWeekInKolkata(targetStartUtc);

    // Identify any departments that have an active blackout period during this interval
    const departmentPolicies = await prisma.departmentPolicy.findMany({
      where: { blackoutPeriods: { not: null } },
      select: { department: true, blackoutPeriods: true },
    });

    const blackoutDepartments: string[] = [];
    for (const policy of departmentPolicies) {
      if (!policy.blackoutPeriods) continue;
      try {
        const blackouts = JSON.parse(policy.blackoutPeriods) as Array<{
          start: string;
          end: string;
        }>;
        for (const b of blackouts) {
          const bStart = new Date(b.start);
          const bEnd = new Date(b.end);
          if (targetStartUtc < bEnd && targetEndUtc > bStart) {
            blackoutDepartments.push(policy.department);
            break;
          }
        }
      } catch {
        // Ignore JSON parse errors in malformed policies
      }
    }

    // Set-based availability condition (compiled to SQL NOT EXISTS)
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { isUnderMaintenance: false },
      // 1. Exclude resources with overlapping active bookings
      {
        bookings: {
          none: {
            status: {
              in: [
                BookingStatus.PENDING,
                BookingStatus.APPROVED,
                BookingStatus.CONFIRMED,
                BookingStatus.CHECKED_IN,
              ],
            },
            startTime: { lt: targetEndUtc },
            endTime: { gt: targetStartUtc },
          },
        },
      },
      // 2. Exclude resources with overlapping timetable classes on this weekday
      {
        timetableEntries: {
          none: {
            dayOfWeek: dayOfWeekKolkata,
            startTime: { lt: endParam },
            endTime: { gt: startParam },
          },
        },
      },
    ];

    if (blackoutDepartments.length > 0) {
      where.department = { notIn: blackoutDepartments };
    }
  }

  // 5. Database-level Count and Pagination Execution (Exactly 2 set-based queries)
  const total = await prisma.resource.count({ where });

  const skip = (page - 1) * limit;
  const resources = await prisma.resource.findMany({
    where,
    skip,
    take: limit,
    orderBy,
  });

  const totalPages = Math.ceil(total / limit) || 1;
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  const pagination: PaginationMeta = {
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    hasPrevPage,
  };

  const safeResources = resources.map(({ checkInSecretEncrypted: _omit, ...rest }) => rest);

  return ok({
    resources: safeResources,
    pagination,
  });
});
