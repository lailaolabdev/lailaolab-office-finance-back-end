import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { transactionController } from '../controllers/transaction.controller';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(transactionController.list));
router.get('/daily-summary', asyncHandler(transactionController.dailySummary));
router.get('/summary', asyncHandler(transactionController.summary));
router.get('/:id', asyncHandler(transactionController.get));
router.post('/', asyncHandler(transactionController.create));
router.patch(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT_LEAD),
  asyncHandler(transactionController.update),
);
router.post(
  '/:id/void',
  authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT_LEAD),
  asyncHandler(transactionController.void),
);
router.post(
  '/:id/approve',
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(transactionController.approve),
);
router.post(
  '/:id/reject',
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(transactionController.reject),
);

export default router;
