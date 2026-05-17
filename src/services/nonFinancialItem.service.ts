import { NonFinancialItemType, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { NotFoundError } from '../utils/errors';

export interface NonFinancialItemInput {
  type: NonFinancialItemType;
  description: string;
  amount: number;
  currency?: string | null;
  date: Date;
}

export const nonFinancialItemService = {
  async list(type?: NonFinancialItemType) {
    return prisma.nonFinancialItem.findMany({
      where: type ? { type } : undefined,
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });
  },

  async getById(id: string) {
    const item = await prisma.nonFinancialItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundError('Non-financial item not found');
    return item;
  },

  async create(data: NonFinancialItemInput) {
    return prisma.nonFinancialItem.create({
      data: {
        type: data.type,
        description: data.description,
        amount: data.amount,
        currency: data.currency ?? null,
        date: data.date,
      },
    });
  },

  async update(id: string, data: Partial<NonFinancialItemInput>) {
    await this.getById(id);
    const payload: Prisma.NonFinancialItemUpdateInput = {};
    if (data.type !== undefined) payload.type = data.type;
    if (data.description !== undefined) payload.description = data.description;
    if (data.amount !== undefined) payload.amount = data.amount;
    if (data.currency !== undefined) payload.currency = data.currency;
    if (data.date !== undefined) payload.date = data.date;
    return prisma.nonFinancialItem.update({ where: { id }, data: payload });
  },

  async delete(id: string) {
    await this.getById(id);
    return prisma.nonFinancialItem.delete({ where: { id } });
  },
};
