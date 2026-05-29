import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { nonFinancialItemController } from '../controllers/nonFinancialItem.controller';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();
router.use(authenticate);

router.get('/summary', asyncHandler(nonFinancialItemController.summary));
router.get('/', asyncHandler(nonFinancialItemController.list));

router.get('/:id', asyncHandler(nonFinancialItemController.get));
router.post(
  '/',
  authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT_LEAD),
  asyncHandler(nonFinancialItemController.create),
);
router.patch(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT_LEAD),
  asyncHandler(nonFinancialItemController.update),
);
router.delete(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(nonFinancialItemController.delete),
);

export default router;
