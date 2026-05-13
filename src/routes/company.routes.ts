import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { companyController } from '../controllers/company.controller';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(companyController.list));
router.get('/:id', asyncHandler(companyController.get));
router.post('/', authorize(UserRole.ADMIN, UserRole.MANAGER), asyncHandler(companyController.create));
router.patch('/:id', authorize(UserRole.ADMIN, UserRole.MANAGER), asyncHandler(companyController.update));
router.delete('/:id', authorize(UserRole.ADMIN), asyncHandler(companyController.delete));

export default router;
