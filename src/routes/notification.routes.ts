import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { notificationController } from '../controllers/notification.controller';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(notificationController.list));
router.get('/unread-count', asyncHandler(notificationController.unreadCount));
router.patch('/mark-all-read', asyncHandler(notificationController.markAllRead));
router.delete('/read', asyncHandler(notificationController.deleteAllRead));
router.patch('/:id/read', asyncHandler(notificationController.markRead));
router.delete('/:id', asyncHandler(notificationController.delete));

// Manual triggers — admin only
router.post(
  '/trigger/low-balance',
  authorize(UserRole.ADMIN),
  asyncHandler(notificationController.triggerLowBalance),
);
router.post(
  '/trigger/daily-reminder',
  authorize(UserRole.ADMIN),
  asyncHandler(notificationController.triggerDailyReminder),
);

export default router;
