import { Prisma, TransactionStatus, TransactionType, Currency } from '@prisma/client';
import { prisma } from '../config/prisma';
import { ConflictError, NotFoundError } from '../utils/errors';
import { notificationService } from './notification.service';
import { settingsService } from './settings.service';

async function getApprovalLimit(currency: Currency): Promise<number> {
  const key = `approval.limit${currency}`;
  const s = await settingsService.get(key);
  if (s?.value !== undefined && s.value !== null) return Number(s.value);
  // Sensible defaults if not configured
  const defaults: Record<Currency, number> = {
    LAK: 10_000_000,
    THB: 100_000,
    USD: 5_000,
    CNY: 30_000,
    VND: 25_000_000,
  };
  return defaults[currency];
}

interface ListFilters {
  companyId?: string;
  bankAccountId?: string;
  categoryId?: string;
  subCategoryId?: string;
  type?: TransactionType;
  status?: TransactionStatus;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  amountMin?: number;
  amountMax?: number;
  page?: number;
  pageSize?: number;
}

interface CreateInput {
  companyId: string;
  bankAccountId: string;
  type: TransactionType;
  transactionDate: Date;
  amount: number;
  currency?: Currency;
  exchangeRate?: number;
  categoryId?: string;
  subCategoryId?: string;
  partyId?: string;
  description: string;
  note?: string;
  bankReference?: string;
  externalRef?: string;
  transferToAccountId?: string;
  source?: string;
  statementFileId?: string;
  createdById: string;
}

const generateReference = (type: TransactionType) => {
  const prefix = type === 'INCOME' ? 'IN' : type === 'EXPENSE' ? 'EX' : 'TF';
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${date}-${random}`;
};

export const transactionService = {
  async list(filters: ListFilters = {}) {
    const {
      page = 1,
      pageSize = 20,
      dateFrom,
      dateTo,
      search,
      amountMin,
      amountMax,
      ...rest
    } = filters;

    const where: Prisma.TransactionWhereInput = {
      ...rest,
      ...(dateFrom || dateTo
        ? { transactionDate: { gte: dateFrom, lte: dateTo } }
        : {}),
      ...(amountMin !== undefined || amountMax !== undefined
        ? { amount: { gte: amountMin, lte: amountMax } }
        : {}),
      ...(search
        ? {
            OR: [
              { description: { contains: search, mode: 'insensitive' } },
              { reference: { contains: search, mode: 'insensitive' } },
              { bankReference: { contains: search, mode: 'insensitive' } },
              { note: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          company: true,
          bankAccount: { include: { bank: true } },
          category: true,
          subCategory: true,
          party: true,
          createdBy: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { transactionDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.transaction.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },

  async getById(id: string) {
    const txn = await prisma.transaction.findUnique({
      where: { id },
      include: {
        company: true,
        bankAccount: { include: { bank: true } },
        category: true,
        party: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        approvedBy: { select: { id: true, fullName: true } },
        attachments: true,
        tags: { include: { tag: true } },
      },
    });
    if (!txn) throw new NotFoundError('Transaction not found');
    return txn;
  },

  async create(input: CreateInput) {
    // Duplicate detection: same date + amount + bankAccount + bankReference
    if (input.bankReference) {
      const dup = await prisma.transaction.findFirst({
        where: {
          bankAccountId: input.bankAccountId,
          bankReference: input.bankReference,
          transactionDate: input.transactionDate,
          amount: input.amount,
        },
      });
      if (dup) {
        throw new ConflictError('Duplicate transaction detected', { existingId: dup.id });
      }
    }

    const reference = generateReference(input.type);
    const currency = input.currency ?? 'LAK';

    // exchangeRate = how many LAK is one unit of this currency worth
    // For LAK transactions, it's always 1. For others, fetch from latest rates.
    let exchangeRate = input.exchangeRate;
    if (exchangeRate === undefined) {
      if (currency === 'LAK') {
        exchangeRate = 1;
      } else {
        // Fetch the latest rate where: 1 unit of currency = rate units of LAK
        const latest = await prisma.exchangeRate.findFirst({
          where: {
            fromCurrency: currency,
            toCurrency: 'LAK',
            effectiveAt: { lte: input.transactionDate },
          },
          orderBy: { effectiveAt: 'desc' },
        });
        exchangeRate = latest ? Number(latest.rate) : 1;
      }
    }

    // 4.10 / 9.4 — high-value transactions need approval before posting
    const limit = await getApprovalLimit(currency);
    const needsApproval = input.amount > limit && input.type !== 'INCOME';

    const created = await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          reference,
          companyId: input.companyId,
          bankAccountId: input.bankAccountId,
          type: input.type,
          transactionDate: input.transactionDate,
          amount: input.amount,
          currency,
          exchangeRate,
          amountInBase: input.amount * exchangeRate,
          categoryId: input.categoryId,
          subCategoryId: input.subCategoryId,
          partyId: input.partyId,
          description: input.description,
          note: input.note,
          bankReference: input.bankReference,
          externalRef: input.externalRef,
          transferToAccountId: input.transferToAccountId,
          source: input.source ?? 'MANUAL',
          statementFileId: input.statementFileId,
          createdById: input.createdById,
          status: needsApproval ? 'PENDING_APPROVAL' : 'POSTED',
          postedAt: needsApproval ? null : new Date(),
        },
      });

      if (!needsApproval) {
        const delta = input.type === 'INCOME' ? input.amount : -input.amount;
        await tx.bankAccount.update({
          where: { id: input.bankAccountId },
          data: { currentBalance: { increment: delta } },
        });

        if (input.type === 'TRANSFER' && input.transferToAccountId) {
          await tx.bankAccount.update({
            where: { id: input.transferToAccountId },
            data: { currentBalance: { increment: input.amount } },
          });
        }
      }

      return txn;
    });

    // Side-effects outside the DB transaction — failures here shouldn't roll
    // back the financial record.
    if (needsApproval) {
      await notificationService.notifyByRoles(
        ['ADMIN', 'MANAGER'],
        {
          type: 'APPROVAL_REQUEST',
          title: 'ມີລາຍການລໍຖ້າອະນຸມັດ',
          message: `${created.reference}: ${input.description} — ${input.amount.toLocaleString()} ${currency}`,
          link: `/transactions?status=PENDING_APPROVAL`,
        },
        input.createdById,
      );
    } else {
      // Fire-and-forget low balance check after balance change
      notificationService.checkLowBalance().catch(() => undefined);
    }

    return created;
  },

  async approve(id: string, approverId: string) {
    const existing = await this.getById(id);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new ConflictError('Transaction is not pending approval');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const approved = await tx.transaction.update({
        where: { id },
        data: {
          status: 'POSTED',
          approvedById: approverId,
          approvedAt: new Date(),
          postedAt: new Date(),
        },
      });

      const delta =
        existing.type === 'INCOME' ? Number(existing.amount) : -Number(existing.amount);
      await tx.bankAccount.update({
        where: { id: existing.bankAccountId },
        data: { currentBalance: { increment: delta } },
      });

      if (existing.type === 'TRANSFER' && existing.transferToAccountId) {
        await tx.bankAccount.update({
          where: { id: existing.transferToAccountId },
          data: { currentBalance: { increment: Number(existing.amount) } },
        });
      }

      await tx.activityLog.create({
        data: {
          userId: approverId,
          action: 'APPROVE_TRANSACTION',
          entityType: 'Transaction',
          entityId: id,
        },
      });

      return approved;
    });

    await notificationService.create({
      userId: existing.createdById,
      type: 'INFO',
      title: 'ລາຍການຖືກອະນຸມັດ',
      message: `${existing.reference}: ${existing.description}`,
      link: `/transactions`,
    });

    notificationService.checkLowBalance().catch(() => undefined);
    return updated;
  },

  async reject(id: string, approverId: string, reason: string) {
    const existing = await this.getById(id);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new ConflictError('Transaction is not pending approval');
    }

    const updated = await prisma.transaction.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approvedById: approverId,
        approvedAt: new Date(),
        voidReason: reason,
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: approverId,
        action: 'REJECT_TRANSACTION',
        entityType: 'Transaction',
        entityId: id,
        newValue: { reason },
      },
    });

    await notificationService.create({
      userId: existing.createdById,
      type: 'WARNING',
      title: 'ລາຍການຖືກປະຕິເສດ',
      message: `${existing.reference}: ${reason}`,
      link: `/transactions`,
    });

    return updated;
  },

  async update(
    id: string,
    data: Partial<{
      transactionDate: Date;
      amount: number;
      currency: Currency;
      exchangeRate: number;
      categoryId: string | null;
      subCategoryId: string | null;
      partyId: string | null;
      description: string;
      note: string | null;
      bankReference: string | null;
      externalRef: string | null;
    }>,
    userId: string,
  ) {
    const existing = await this.getById(id);
    if (existing.status === 'VOIDED') {
      throw new ConflictError('Cannot edit a voided transaction');
    }

    const newAmount = data.amount ?? Number(existing.amount);
    const newCurrency = data.currency ?? existing.currency;
    let newRate = data.exchangeRate;

    // If rate not provided, fetch the latest for this currency
    if (newRate === undefined) {
      if (newCurrency === 'LAK') {
        newRate = 1;
      } else {
        const latest = await prisma.exchangeRate.findFirst({
          where: {
            fromCurrency: newCurrency,
            toCurrency: 'LAK',
            effectiveAt: { lte: existing.transactionDate },
          },
          orderBy: { effectiveAt: 'desc' },
        });
        newRate = latest ? Number(latest.rate) : Number(existing.exchangeRate);
      }
    }

    return prisma.$transaction(async (tx) => {
      // If amount changed, adjust the bank account balance by the delta
      if (data.amount !== undefined && data.amount !== Number(existing.amount)) {
        const oldSigned = existing.type === 'INCOME' ? Number(existing.amount) : -Number(existing.amount);
        const newSigned = existing.type === 'INCOME' ? newAmount : -newAmount;
        const delta = newSigned - oldSigned;
        await tx.bankAccount.update({
          where: { id: existing.bankAccountId },
          data: { currentBalance: { increment: delta } },
        });
      }

      const updated = await tx.transaction.update({
        where: { id },
        data: {
          ...data,
          amountInBase: newAmount * newRate,
        },
      });

      await tx.activityLog.create({
        data: {
          userId,
          action: 'UPDATE_TRANSACTION',
          entityType: 'Transaction',
          entityId: id,
          newValue: data as never,
        },
      });

      return updated;
    });
  },

  async void(id: string, voidReason: string, userId: string) {
    const txn = await this.getById(id);
    if (txn.status === 'VOIDED') throw new ConflictError('Transaction already voided');

    return prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.update({
        where: { id },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason },
      });

      // Reverse balance
      const delta = txn.type === 'INCOME' ? -Number(txn.amount) : Number(txn.amount);
      await tx.bankAccount.update({
        where: { id: txn.bankAccountId },
        data: { currentBalance: { increment: delta } },
      });

      await tx.activityLog.create({
        data: {
          userId,
          action: 'VOID_TRANSACTION',
          entityType: 'Transaction',
          entityId: id,
          newValue: { voidReason },
        },
      });

      return updated;
    });
  },

  async dailySummary(date: Date, companyId?: string) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const where: Prisma.TransactionWhereInput = {
      transactionDate: { gte: start, lte: end },
      status: 'POSTED',
      ...(companyId ? { companyId } : {}),
    };

    const [income, expense, transactions] = await Promise.all([
      prisma.transaction.aggregate({
        where: { ...where, type: 'INCOME' },
        _sum: { amountInBase: true },
        _count: true,
      }),
      prisma.transaction.aggregate({
        where: { ...where, type: 'EXPENSE' },
        _sum: { amountInBase: true },
        _count: true,
      }),
      prisma.transaction.findMany({
        where,
        include: { category: true, subCategory: true, bankAccount: { include: { bank: true } } },
        orderBy: { transactionDate: 'desc' },
      }),
    ]);

    return {
      date,
      totalIncome: income._sum.amountInBase ?? 0,
      totalExpense: expense._sum.amountInBase ?? 0,
      net: Number(income._sum.amountInBase ?? 0) - Number(expense._sum.amountInBase ?? 0),
      incomeCount: income._count,
      expenseCount: expense._count,
      transactions,
    };
  },

  async summary(filters: { companyId?: string; dateFrom?: Date; dateTo?: Date }) {
    const { companyId, dateFrom, dateTo } = filters;
    const where: Prisma.TransactionWhereInput = {
      status: { not: 'VOIDED' },
      ...(companyId ? { companyId } : {}),
      ...(dateFrom || dateTo ? { transactionDate: { gte: dateFrom, lte: dateTo } } : {}),
    };

    // 1. Overall totals per currency
    const byCurrency = await prisma.transaction.groupBy({
      by: ['currency', 'type'],
      where,
      _sum: { amount: true },
      _count: true,
    });

    const byCurrencyCategory = await prisma.transaction.groupBy({
      by: ['currency', 'categoryId', 'type'],
      where,
      _sum: { amount: true },
      _count: true,
    });

    const byCurrencySubCategory = await prisma.transaction.groupBy({
      by: ['currency', 'subCategoryId', 'categoryId', 'type'],
      where: { ...where, subCategoryId: { not: null } },
      _sum: { amount: true },
      _count: true,
    });

    // 2. Per category (parent) — use amountInBase for cross-currency totals
    const byCategory = await prisma.transaction.groupBy({
      by: ['categoryId', 'type'],
      where,
      _sum: { amountInBase: true },
      _count: true,
    });

    // 3. Per sub-category
    const bySubCategory = await prisma.transaction.groupBy({
      by: ['subCategoryId', 'categoryId', 'type'],
      where: { ...where, subCategoryId: { not: null } },
      _sum: { amountInBase: true },
      _count: true,
    });

    // Fetch category & sub-category names in one shot
    const catIds = [...new Set([...byCategory.map((r) => r.categoryId), ...byCurrencyCategory.map((r) => r.categoryId)].filter(Boolean) as string[])];
    const subIds = [...new Set([...bySubCategory.map((r) => r.subCategoryId), ...byCurrencySubCategory.map((r) => r.subCategoryId)].filter(Boolean) as string[])];

    const [cats, subs] = await Promise.all([
      catIds.length
        ? prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true, code: true } })
        : [],
      subIds.length
        ? prisma.subCategory.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true, code: true, categoryId: true } })
        : [],
    ]);

    const catMap = Object.fromEntries(cats.map((c) => [c.id, c]));
    const subMap = Object.fromEntries(subs.map((s) => [s.id, s]));

    // Shape byCurrency into { currency, income, expense, incomeCount, expenseCount }
    const currencyMap: Record<string, { currency: string; income: number; expense: number; incomeCount: number; expenseCount: number; categories: any[]; subCategories: any[] }> = {};
    for (const row of byCurrency) {
      if (!currencyMap[row.currency]) {
        currencyMap[row.currency] = { currency: row.currency, income: 0, expense: 0, incomeCount: 0, expenseCount: 0, categories: [], subCategories: [] };
      }
      const amt = Number(row._sum.amount ?? 0);
      if (row.type === 'INCOME') {
        currencyMap[row.currency].income += amt;
        currencyMap[row.currency].incomeCount += row._count;
      } else if (row.type === 'EXPENSE') {
        currencyMap[row.currency].expense += amt;
        currencyMap[row.currency].expenseCount += row._count;
      }
    }

    for (const row of byCurrencyCategory) {
      if (!currencyMap[row.currency]) continue;
      let catObj = currencyMap[row.currency].categories.find((c) => c.categoryId === row.categoryId);
      if (!catObj) {
        const cat = row.categoryId ? catMap[row.categoryId] : null;
        catObj = { categoryId: row.categoryId, name: cat?.name ?? 'ບໍ່ມີໝວດ', code: cat?.code ?? '', income: 0, expense: 0, count: 0 };
        currencyMap[row.currency].categories.push(catObj);
      }
      const amt = Number(row._sum.amount ?? 0);
      if (row.type === 'INCOME') catObj.income += amt;
      else if (row.type === 'EXPENSE') catObj.expense += amt;
      catObj.count += row._count;
    }

    for (const row of byCurrencySubCategory) {
      if (!row.subCategoryId || !currencyMap[row.currency]) continue;
      let subObj = currencyMap[row.currency].subCategories.find((s) => s.subCategoryId === row.subCategoryId);
      if (!subObj) {
        const sub = subMap[row.subCategoryId];
        subObj = { subCategoryId: row.subCategoryId, categoryId: row.categoryId, name: sub?.name ?? row.subCategoryId, code: sub?.code ?? '', income: 0, expense: 0, count: 0 };
        currencyMap[row.currency].subCategories.push(subObj);
      }
      const amt = Number(row._sum.amount ?? 0);
      if (row.type === 'INCOME') subObj.income += amt;
      else if (row.type === 'EXPENSE') subObj.expense += amt;
      subObj.count += row._count;
    }

    for (const cur of Object.values(currencyMap)) {
      cur.categories.sort((a, b) => (b.income + b.expense) - (a.income + a.expense));
      cur.subCategories.sort((a, b) => (b.income + b.expense) - (a.income + a.expense));
    }

    // Shape byCategory
    const categoryMap: Record<string, { categoryId: string | null; name: string; code: string; income: number; expense: number; count: number }> = {};
    for (const row of byCategory) {
      const key = row.categoryId ?? '__none__';
      if (!categoryMap[key]) {
        const cat = row.categoryId ? catMap[row.categoryId] : null;
        categoryMap[key] = { categoryId: row.categoryId, name: cat?.name ?? 'ບໍ່ມີໝວດ', code: cat?.code ?? '', income: 0, expense: 0, count: 0 };
      }
      const amt = Number(row._sum.amountInBase ?? 0);
      if (row.type === 'INCOME') categoryMap[key].income += amt;
      else if (row.type === 'EXPENSE') categoryMap[key].expense += amt;
      categoryMap[key].count += row._count;
    }

    // Shape bySubCategory
    const subCategoryMap: Record<string, { subCategoryId: string; categoryId: string | null; name: string; code: string; income: number; expense: number; count: number }> = {};
    for (const row of bySubCategory) {
      if (!row.subCategoryId) continue;
      const key = row.subCategoryId;
      if (!subCategoryMap[key]) {
        const sub = subMap[row.subCategoryId];
        subCategoryMap[key] = { subCategoryId: row.subCategoryId, categoryId: row.categoryId, name: sub?.name ?? row.subCategoryId, code: sub?.code ?? '', income: 0, expense: 0, count: 0 };
      }
      const amt = Number(row._sum.amountInBase ?? 0);
      if (row.type === 'INCOME') subCategoryMap[key].income += amt;
      else if (row.type === 'EXPENSE') subCategoryMap[key].expense += amt;
      subCategoryMap[key].count += row._count;
    }

    return {
      currencies: Object.values(currencyMap).sort((a, b) => a.currency.localeCompare(b.currency)),
      categories: Object.values(categoryMap).sort((a, b) => (b.income + b.expense) - (a.income + a.expense)),
      subCategories: Object.values(subCategoryMap).sort((a, b) => (b.income + b.expense) - (a.income + a.expense)),
    };
  },
};
