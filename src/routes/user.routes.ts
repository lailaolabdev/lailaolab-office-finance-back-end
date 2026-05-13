import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { userController } from '../controllers/user.controller';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);
router.use(authorize(UserRole.ADMIN));

router.get('/', asyncHandler(userController.list));
router.get('/:id', asyncHandler(userController.get));
router.post('/', asyncHandler(userController.create));
router.patch('/:id', asyncHandler(userController.update));
router.delete('/:id', asyncHandler(userController.delete));

export default router;
