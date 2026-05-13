import { Router } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError } from '../utils/errors';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  categoryId: z.string().cuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

const updateSchema = createSchema.partial();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const categoryId = req.query.categoryId as string | undefined;
    const items = await prisma.subCategory.findMany({
      where: { isActive: true, ...(categoryId ? { categoryId } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: { category: { select: { id: true, name: true } } },
    });
    res.json({ success: true, data: items });
  }),
);

router.post(
  '/',
  authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT_LEAD),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);

    const parent = await prisma.category.findUnique({ where: { id: data.categoryId } });
    if (!parent) throw new BadRequestError('Parent category not found');

    const created = await prisma.subCategory.create({ data });
    res.status(201).json({ success: true, data: created });
  }),
);

router.patch(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.MANAGER, UserRole.ACCOUNTANT_LEAD),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const exists = await prisma.subCategory.findUnique({ where: { id: req.params.id } });
    if (!exists) throw new NotFoundError('Sub-category not found');

    if (data.categoryId) {
      const parent = await prisma.category.findUnique({ where: { id: data.categoryId } });
      if (!parent) throw new BadRequestError('Parent category not found');
    }

    const updated = await prisma.subCategory.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: updated });
  }),
);

router.delete(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(async (req, res) => {
    const target = await prisma.subCategory.findUnique({ where: { id: req.params.id } });
    if (!target) throw new NotFoundError('Sub-category not found');

    await prisma.subCategory.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });

    res.json({ success: true });
  }),
);

export default router;
