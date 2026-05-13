import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { settingsController } from '../controllers/settings.controller';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();
router.use(authenticate);

// Exchange rates (ordered before /:key to avoid param conflict)
router.get('/exchange-rates', asyncHandler(settingsController.listExchangeRates));
router.post(
  '/exchange-rates',
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(settingsController.setExchangeRate),
);

// Bulk upsert settings
router.post(
  '/bulk',
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(settingsController.setBulk),
);

// Individual setting
router.get('/', asyncHandler(settingsController.list));
router.get('/:key', asyncHandler(settingsController.get));
router.post('/', authorize(UserRole.ADMIN, UserRole.MANAGER), asyncHandler(settingsController.set));

export default router;
