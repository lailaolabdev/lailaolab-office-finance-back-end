import { Router } from 'express';
import { importController } from '../controllers/import.controller';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { upload } from '../middleware/upload';
import { UserRole } from '@prisma/client';

const router = Router();

router.use(authenticate);

router.get('/templates', asyncHandler(importController.templates));

router.post(
  '/parse',
  authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT_LEAD),
  upload.single('file'),
  asyncHandler(importController.parse),
);

router.post(
  '/ingest',
  authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT_LEAD),
  upload.single('file'),
  asyncHandler(importController.ingest),
);

export default router;
