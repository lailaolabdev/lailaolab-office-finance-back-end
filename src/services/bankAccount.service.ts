import { AccountType, Currency } from '@prisma/client';
import { prisma } from '../config/prisma';
import { ConflictError, NotFoundError } from '../utils/errors';

export const bankAccountService = {
  async list(filter: { companyId?: string; bankId?: string } = {}) {
    return prisma.bankAccount.findMany({
      where: filter,
      include: { company: true, bank: true },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getById(id: string) {
    const account = await prisma.bankAccount.findUnique({
      where: { id },
      include: { company: true, bank: true },
    });
    if (!account) throw new NotFoundError('Bank account not found');
    return account;
  },

  async create(data: {
    companyId: string;
    bankId: string;
    accountNumber: string;
    accountName: string;
    accountType?: AccountType;
    currency?: Currency;
    openingBalance?: number;
    note?: string;
  }) {
    const exists = await prisma.bankAccount.findUnique({
      where: {
        companyId_bankId_accountNumber: {
          companyId: data.companyId,
          bankId: data.bankId,
          accountNumber: data.accountNumber,
        },
      },
    });
    if (exists) throw new ConflictError('Bank account already exists for this company');

    return prisma.bankAccount.create({
      data: {
        ...data,
        currentBalance: data.openingBalance ?? 0,
      },
    });
  },

  async update(id: string, data: Partial<{
    accountName: string;
    accountType: AccountType;
    currency: Currency;
    note: string;
    isActive: boolean;
  }>) {
    await this.getById(id);
    return prisma.bankAccount.update({ where: { id }, data });
  },

  async delete(id: string) {
    await this.getById(id);
    return prisma.bankAccount.update({ where: { id }, data: { isActive: false } });
  },
};
