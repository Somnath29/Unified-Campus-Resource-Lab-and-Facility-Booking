import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/notifications
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;

    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    const unreadCount = await prisma.notification.count({
      where: {
        userId: user.id,
        read: false,
      },
    });

    return res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    return res.status(500).json({ error: 'Failed to retrieve notifications.' });
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    await prisma.notification.updateMany({
      where: {
        id,
        userId: user.id,
      },
      data: { read: true },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('Error marking notification read:', err);
    return res.status(500).json({ error: 'Failed to update notification.' });
  }
});

// PUT /api/notifications/read-all
router.put('/read-all', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;

    await prisma.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });

    return res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    console.error('Error marking all notifications read:', err);
    return res.status(500).json({ error: 'Failed to update notifications.' });
  }
});

export default router;

