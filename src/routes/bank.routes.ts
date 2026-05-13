import { Router } from 'express';
import { prisma } from '../config/prisma';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const banks = await prisma.bank.findMany({ orderBy: { code: 'asc' } });
    res.json({ success: true, data: banks });
  }),
);

export default router;
