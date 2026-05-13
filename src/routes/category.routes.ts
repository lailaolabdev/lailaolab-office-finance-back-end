import { Router } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { NotFoundError } from '../utils/errors';

const router = Router();
router.use(authenticate);

const upsertSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const flat = req.query.flat === 'true';

    if (flat) {
      const items = await prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      });
      return res.json({ success: true, data: items });
    }

    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: {
        subCategories: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        },
      },
    });
    res.json({ success: true, data: categories });
  }),
);

router.post(
  '/',
  authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT_LEAD),
  asyncHandler(async (req, res) => {
    const data = upsertSchema.parse(req.body);
    const created = await prisma.category.create({ data });
    res.status(201).json({ success: true, data: created });
  }),
);

router.patch(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT_LEAD),
  asyncHandler(async (req, res) => {
    const data = upsertSchema.partial().parse(req.body);
    const exists = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!exists) throw new NotFoundError('Category not found');

    const updated = await prisma.category.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: updated });
  }),
);

router.delete(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(async (req, res) => {
    const target = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!target) throw new NotFoundError('Category not found');

    // Cascade soft-delete: parent + all its sub-categories
    await prisma.$transaction([
      prisma.category.update({
        where: { id: req.params.id },
        data: { isActive: false },
      }),
      prisma.subCategory.updateMany({
        where: { categoryId: req.params.id, isActive: true },
        data: { isActive: false },
      }),
    ]);

    res.json({ success: true });
  }),
);

export default router;
