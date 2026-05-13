import { Request, Response } from 'express';
import { z } from 'zod';
import { TransactionStatus, TransactionType, Currency } from '@prisma/client';
import { transactionService } from '../services/transaction.service';
import { UnauthorizedError } from '../utils/errors';

const listSchema = z.object({
  companyId: z.string().optional(),
  bankAccountId: z.string().optional(),
  categoryId: z.string().optional(),
  subCategoryId: z.string().optional(),
  type: z.nativeEnum(TransactionType).optional(),
  status: z.nativeEnum(TransactionStatus).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  search: z.string().optional(),
  amountMin: z.coerce.number().positive().optional(),
  amountMax: z.coerce.number().positive().optional(),
  page: z.coerce.number().default(1),
  pageSize: z.coerce.number().default(20),
});

const createSchema = z.object({
  companyId: z.string().cuid(),
  bankAccountId: z.string().cuid(),
  type: z.nativeEnum(TransactionType),
  transactionDate: z.coerce.date(),
  amount: z.number().positive(),
  currency: z.nativeEnum(Currency).optional(),
  exchangeRate: z.number().positive().optional(),
  categoryId: z.string().cuid().optional(),
  subCategoryId: z.string().cuid().optional(),
  partyId: z.string().cuid().optional(),
  description: z.string().min(1),
  note: z.string().optional(),
  bankReference: z.string().optional(),
  externalRef: z.string().optional(),
  transferToAccountId: z.string().cuid().optional(),
});

const updateSchema = z.object({
  transactionDate: z.coerce.date().optional(),
  amount: z.number().positive().optional(),
  currency: z.nativeEnum(Currency).optional(),
  exchangeRate: z.number().positive().optional(),
  categoryId: z.string().cuid().nullable().optional(),
  subCategoryId: z.string().cuid().nullable().optional(),
  partyId: z.string().cuid().nullable().optional(),
  description: z.string().min(1).optional(),
  note: z.string().nullable().optional(),
  bankReference: z.string().nullable().optional(),
  externalRef: z.string().nullable().optional(),
});

const voidSchema = z.object({
  reason: z.string().min(1),
});

const rejectSchema = z.object({
  reason: z.string().min(1),
});

export const transactionController = {
  async list(req: Request, res: Response) {
    const filters = listSchema.parse(req.query);
    const result = await transactionService.list(filters);
    res.json({ success: true, ...result });
  },

  async get(req: Request, res: Response) {
    const txn = await transactionService.getById(req.params.id);
    res.json({ success: true, data: txn });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const data = createSchema.parse(req.body);
    const txn = await transactionService.create({
      ...data,
      createdById: req.user.userId,
    });
    res.status(201).json({ success: true, data: txn });
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const data = updateSchema.parse(req.body);
    const txn = await transactionService.update(req.params.id, data, req.user.userId);
    res.json({ success: true, data: txn });
  },

  async void(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { reason } = voidSchema.parse(req.body);
    const txn = await transactionService.void(req.params.id, reason, req.user.userId);
    res.json({ success: true, data: txn });
  },

  async approve(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const txn = await transactionService.approve(req.params.id, req.user.userId);
    res.json({ success: true, data: txn });
  },

  async reject(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const { reason } = rejectSchema.parse(req.body);
    const txn = await transactionService.reject(req.params.id, req.user.userId, reason);
    res.json({ success: true, data: txn });
  },

  async dailySummary(req: Request, res: Response) {
    const date = req.query.date ? new Date(req.query.date as string) : new Date();
    const companyId = req.query.companyId as string | undefined;
    const summary = await transactionService.dailySummary(date, companyId);
    res.json({ success: true, data: summary });
  },

  async summary(req: Request, res: Response) {
    const schema = z.object({
      companyId: z.string().optional(),
      dateFrom: z.coerce.date().optional(),
      dateTo: z.coerce.date().optional(),
    });
    const filters = schema.parse(req.query);
    const data = await transactionService.summary(filters);
    res.json({ success: true, data });
  },
};
