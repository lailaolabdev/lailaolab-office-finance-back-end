import { Request, Response } from 'express';
import { z } from 'zod';
import { AccountType, Currency } from '@prisma/client';
import { bankAccountService } from '../services/bankAccount.service';

const createSchema = z.object({
  companyId: z.string().cuid(),
  bankId: z.string().cuid(),
  accountNumber: z.string().min(1),
  accountName: z.string().min(1),
  accountType: z.nativeEnum(AccountType).optional(),
  currency: z.nativeEnum(Currency).optional(),
  openingBalance: z.number().optional(),
  note: z.string().optional(),
});

const updateSchema = z.object({
  accountName: z.string().optional(),
  accountType: z.nativeEnum(AccountType).optional(),
  currency: z.nativeEnum(Currency).optional(),
  note: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const bankAccountController = {
  async list(req: Request, res: Response) {
    const { companyId, bankId } = req.query;
    const accounts = await bankAccountService.list({
      companyId: companyId as string | undefined,
      bankId: bankId as string | undefined,
    });
    res.json({ success: true, data: accounts });
  },
  async balanceSummary(req: Request, res: Response) {
    const { companyId } = req.query;
    const summary = await bankAccountService.balanceSummary({
      companyId: companyId as string | undefined,
    });
    res.json({ success: true, data: summary });
  },
  async get(req: Request, res: Response) {
    const account = await bankAccountService.getById(req.params.id);
    res.json({ success: true, data: account });
  },
  async create(req: Request, res: Response) {
    const data = createSchema.parse(req.body);
    const account = await bankAccountService.create(data);
    res.status(201).json({ success: true, data: account });
  },
  async update(req: Request, res: Response) {
    const data = updateSchema.parse(req.body);
    const account = await bankAccountService.update(req.params.id, data);
    res.json({ success: true, data: account });
  },
  async delete(req: Request, res: Response) {
    await bankAccountService.delete(req.params.id);
    res.json({ success: true });
  },
};
