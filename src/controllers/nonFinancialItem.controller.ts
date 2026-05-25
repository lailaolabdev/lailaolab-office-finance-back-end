import { Request, Response } from 'express';
import { z } from 'zod';
import { NonFinancialItemType } from '@prisma/client';
import { nonFinancialItemService } from '../services/nonFinancialItem.service';

const types = Object.values(NonFinancialItemType) as [string, ...string[]];

const baseSchema = z.object({
  type: z.enum(types),
  description: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().nullable().optional(),
  date: z.string().datetime(),
  bankAccountId: z.string().min(1),
});

const createSchema = baseSchema;
const updateSchema = baseSchema.partial();

export const nonFinancialItemController = {
  async list(req: Request, res: Response) {
    const type = req.query.type as NonFinancialItemType | undefined;
    const items = await nonFinancialItemService.list(type);
    res.json({ success: true, data: items });
  },

  async get(req: Request, res: Response) {
    const item = await nonFinancialItemService.getById(req.params.id);
    res.json({ success: true, data: item });
  },

  async create(req: Request, res: Response) {
    const parsed = createSchema.parse(req.body);
    const item = await nonFinancialItemService.create({
      type: parsed.type as NonFinancialItemType,
      description: parsed.description,
      amount: parsed.amount,
      currency: parsed.currency ?? null,
      date: new Date(parsed.date),
      bankAccountId: parsed.bankAccountId,
    });
    res.status(201).json({ success: true, data: item });
  },

  async update(req: Request, res: Response) {
    const parsed = updateSchema.parse(req.body);
    const item = await nonFinancialItemService.update(req.params.id, {
      ...parsed,
      type: parsed.type as NonFinancialItemType | undefined,
      date: parsed.date ? new Date(parsed.date) : undefined,
    });
    res.json({ success: true, data: item });
  },

  async delete(req: Request, res: Response) {
    await nonFinancialItemService.delete(req.params.id);
    res.json({ success: true });
  },
};
