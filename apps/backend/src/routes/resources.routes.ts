import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { ResourceCategory, Prisma } from '@prisma/client';

const router = Router();

// GET /api/resources
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      category,
      building,
      minCapacity,
      amenity,
      search,
      availableOnly,
      includeMaintenance,
    } = req.query;

    const where: Prisma.ResourceWhereInput = {};

    if (category && category !== 'ALL') {
      where.category = category as ResourceCategory;
    }

    if (building && building !== 'ALL' && building !== 'All Buildings') {
      where.building = { contains: String(building), mode: 'insensitive' };
    }

    if (minCapacity) {
      where.capacity = { gte: parseInt(String(minCapacity), 10) };
    }

    if (amenity) {
      const amenitiesList = Array.isArray(amenity)
        ? (amenity as string[])
        : String(amenity).split(',');
      where.amenities = { hasSome: amenitiesList };
    }

    if (search) {
      const q = String(search).trim();
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

    return res.json({
      total: resources.length,
      resources,
    });
  } catch (err) {
    console.error('Error fetching resources:', err);
    return res.status(500).json({ error: 'Failed to retrieve resources.' });
  }
});

// GET /api/resources/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const resource = await prisma.resource.findUnique({
      where: { id },
      include: {
        timetableEntries: true,
        bookings: {
          where: {
            endTime: { gte: new Date() },
            status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING'] },
          },
          orderBy: { startTime: 'asc' },
          take: 10,
          select: {
            id: true,
            bookingNumber: true,
            startTime: true,
            endTime: true,
            purpose: true,
            status: true,
          },
        },
      },
    });

    if (!resource) {
      return res.status(404).json({ error: 'Resource not found.' });
    }

    return res.json({ resource });
  } catch (err) {
    console.error('Error fetching resource details:', err);
    return res.status(500).json({ error: 'Failed to retrieve resource details.' });
  }
});

// POST /api/resources/smart-allocation
router.post('/smart-allocation', async (req: Request, res: Response) => {
  try {
    const { expectedAttendance, activityType, date, timeSlot } = req.body;

    const attendance = Number(expectedAttendance) || 30;

    // Filter by appropriate categories based on activity
    let targetCategories: ResourceCategory[] = [];
    if (activityType === 'LAB_SESSION') {
      targetCategories = [ResourceCategory.LAB];
    } else if (activityType === 'CLUB_EVENT' || activityType === 'GUEST_SEMINAR') {
      targetCategories = [ResourceCategory.SEMINAR_HALL, ResourceCategory.CLASSROOM];
    } else if (activityType === 'FACULTY_MEETING') {
      targetCategories = [ResourceCategory.MEETING_ROOM, ResourceCategory.SEMINAR_HALL];
    } else if (activityType === 'SPORTS_PRACTICE') {
      targetCategories = [ResourceCategory.SPORTS];
    } else {
      targetCategories = [
        ResourceCategory.CLASSROOM,
        ResourceCategory.LAB,
        ResourceCategory.SEMINAR_HALL,
        ResourceCategory.MEETING_ROOM,
      ];
    }

    const candidates = await prisma.resource.findMany({
      where: {
        category: { in: targetCategories },
        capacity: { gte: Math.floor(attendance * 0.8) }, // Reasonable fit
        isUnderMaintenance: false,
      },
      orderBy: { capacity: 'asc' },
      take: 6,
    });

    return res.json({
      matches: candidates,
      criteria: { attendance, activityType, date, timeSlot },
    });
  } catch (err) {
    console.error('Error during smart room allocation:', err);
    return res.status(500).json({ error: 'Smart allocation failed.' });
  }
});

export default router;

