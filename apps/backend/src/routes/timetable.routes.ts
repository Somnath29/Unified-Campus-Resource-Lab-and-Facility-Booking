import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

// GET /api/timetable
router.get('/', async (req: Request, res: Response) => {
  try {
    const { resourceId, department, dayOfWeek } = req.query;

    const where: any = {};
    if (resourceId) where.resourceId = String(resourceId);
    if (department) where.department = String(department);
    if (dayOfWeek !== undefined) where.dayOfWeek = parseInt(String(dayOfWeek), 10);

    const timetable = await prisma.timetableEntry.findMany({
      where,
      include: {
        resource: {
          select: {
            id: true,
            code: true,
            name: true,
            category: true,
            building: true,
          },
        },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });

    return res.json({ timetable });
  } catch (err) {
    console.error('Error fetching timetable:', err);
    return res.status(500).json({ error: 'Failed to retrieve academic timetable.' });
  }
});

export default router;

