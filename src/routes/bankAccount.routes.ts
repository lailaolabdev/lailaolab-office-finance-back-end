import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { bankAccountController } from '../controllers/bankAccount.controller';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(bankAccountController.list));
router.get('/:id', asyncHandler(bankAccountController.get));
router.post('/', authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT_LEAD), asyncHandler(bankAccountController.create));
router.patch('/:id', authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT_LEAD), asyncHandler(bankAccountController.update));
router.delete('/:id', authorize(UserRole.ADMIN), asyncHandler(bankAccountController.delete));

export default router;
