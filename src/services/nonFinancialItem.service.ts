import { NonFinancialItemType, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { BadRequestError, NotFoundError } from '../utils/errors';

export interface NonFinancialItemInput {
  type: NonFinancialItemType;
  description: string;
  amount: number;
  currency?: string | null;
  date: Date;
  bankAccountId: string;
}

const include = {
  bankAccount: {
    include: {
      company: { select: { id: true, code: true, name: true } },
      bank: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.NonFinancialItemInclude;

export const nonFinancialItemService = {
  async list(type?: NonFinancialItemType) {
    return prisma.nonFinancialItem.findMany({
      where: type ? { type } : undefined,
      include,
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });
  },

  async getById(id: string) {
    const item = await prisma.nonFinancialItem.findUnique({ where: { id }, include });
    if (!item) throw new NotFoundError('Non-financial item not found');
    return item;
  },

  async create(data: NonFinancialItemInput) {
    const bankAccount = await prisma.bankAccount.findUnique({ where: { id: data.bankAccountId } });
    if (!bankAccount) throw new NotFoundError('Bank account not found');
    if (data.amount > Number(bankAccount.currentBalance)) {
      throw new BadRequestError(
        `Amount exceeds bank account current balance (${bankAccount.currentBalance} ${bankAccount.currency})`,
      );
    }

    return prisma.nonFinancialItem.create({
      data: {
        type: data.type,
        description: data.description,
        amount: data.amount,
        currency: data.currency ?? null,
        date: data.date,
        bankAccountId: data.bankAccountId,
      },
      include,
    });
  },

  async update(id: string, data: Partial<NonFinancialItemInput>) {
    const existing = await this.getById(id);

    const targetBankAccountId = data.bankAccountId ?? existing.bankAccountId;
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: targetBankAccountId },
    });
    if (!bankAccount) throw new NotFoundError('Bank account not found');

    const targetAmount = data.amount ?? Number(existing.amount);
    if (targetAmount > Number(bankAccount.currentBalance)) {
      throw new BadRequestError(
        `Amount exceeds bank account current balance (${bankAccount.currentBalance} ${bankAccount.currency})`,
      );
    }

    const payload: Prisma.NonFinancialItemUpdateInput = {};
    if (data.type !== undefined) payload.type = data.type;
    if (data.description !== undefined) payload.description = data.description;
    if (data.amount !== undefined) payload.amount = data.amount;
    if (data.currency !== undefined) payload.currency = data.currency;
    if (data.date !== undefined) payload.date = data.date;
    if (data.bankAccountId !== undefined) {
      payload.bankAccount = { connect: { id: data.bankAccountId } };
    }
    return prisma.nonFinancialItem.update({ where: { id }, data: payload, include });
  },

  async delete(id: string) {
    await this.getById(id);
    return prisma.nonFinancialItem.delete({ where: { id } });
  },
};
