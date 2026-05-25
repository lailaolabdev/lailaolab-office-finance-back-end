import { AccountType, Currency, TransactionStatus, TransactionType } from '@prisma/client';
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

  /**
   * Balance snapshot for the dashboard / transactions page:
   * today's currentBalance (live), yesterday's balance (rewound from
   * currentBalance by subtracting today's posted txns), and the same totals
   * rolled up per company. Computed in LAK for cross-currency comparison.
   */
  async balanceSummary(filter: { companyId?: string } = {}) {
    const accountWhere = {
      isActive: true,
      ...(filter.companyId ? { companyId: filter.companyId } : {}),
    };

    const [accounts, latestRates] = await Promise.all([
      prisma.bankAccount.findMany({
        where: accountWhere,
        include: {
          company: { select: { id: true, code: true, name: true } },
          bank: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ company: { code: 'asc' } }, { bank: { code: 'asc' } }],
      }),
      prisma.exchangeRate.findMany({
        where: { toCurrency: 'LAK' },
        orderBy: { effectiveAt: 'desc' },
        take: 50,
      }),
    ]);

    // Build latest rate per fromCurrency → LAK
    const rates: Record<string, number> = { LAK: 1 };
    const seen = new Set<string>();
    for (const r of latestRates) {
      if (seen.has(r.fromCurrency)) continue;
      seen.add(r.fromCurrency);
      rates[r.fromCurrency] = Number(r.rate);
    }

    // Today + yesterday boundaries in server-local time
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    if (accounts.length === 0) {
      return {
        accounts: [],
        companies: [],
        totals: { todayLAK: 0, yesterdayLAK: 0, deltaLAK: 0 },
        asOf: now,
      };
    }

    const acctIds = accounts.map((a) => a.id);

    // Posted transactions on/after start-of-today — needed to rewind currentBalance
    // back to start-of-today (a.k.a. end-of-yesterday).
    const todayTxns = await prisma.transaction.findMany({
      where: {
        bankAccountId: { in: acctIds },
        status: TransactionStatus.POSTED,
        transactionDate: { gte: startOfToday },
      },
      select: { bankAccountId: true, type: true, amount: true },
    });

    // Per-account today-net (income - expense) in account's own currency
    const todayNetByAcct = new Map<string, number>();
    for (const t of todayTxns) {
      const amt = Number(t.amount);
      const signed = t.type === TransactionType.INCOME ? amt : t.type === TransactionType.EXPENSE ? -amt : 0;
      todayNetByAcct.set(t.bankAccountId, (todayNetByAcct.get(t.bankAccountId) ?? 0) + signed);
    }

    const accountRows = accounts.map((a) => {
      const rate = rates[a.currency] ?? 1;
      const today = Number(a.currentBalance);
      const todayNet = todayNetByAcct.get(a.id) ?? 0;
      const yesterday = today - todayNet;
      return {
        id: a.id,
        accountNumber: a.accountNumber,
        accountName: a.accountName,
        currency: a.currency,
        accountType: a.accountType,
        openingBalance: Number(a.openingBalance),
        currentBalance: today,
        yesterdayBalance: yesterday,
        todayChange: todayNet,
        currentBalanceLAK: today * rate,
        yesterdayBalanceLAK: yesterday * rate,
        company: a.company,
        bank: a.bank,
      };
    });

    // Roll up per company (LAK + per-currency breakdown + per-account list)
    type CoAccount = {
      id: string;
      accountNumber: string;
      accountName: string;
      currency: string;
      accountType: string;
      openingBalance: number;
      currentBalance: number;
      yesterdayBalance: number;
      todayChange: number;
      currentBalanceLAK: number;
      yesterdayBalanceLAK: number;
      bank: { id: string; code: string; name: string };
    };
    type Co = {
      companyId: string;
      code: string;
      name: string;
      currentBalanceLAK: number;
      yesterdayBalanceLAK: number;
      todayChangeLAK: number;
      perCurrency: Record<string, { currency: string; current: number; yesterday: number; change: number }>;
      accountCount: number;
      accounts: CoAccount[];
    };
    const coMap = new Map<string, Co>();
    for (const r of accountRows) {
      const cid = r.company.id;
      if (!coMap.has(cid)) {
        coMap.set(cid, {
          companyId: cid,
          code: r.company.code,
          name: r.company.name,
          currentBalanceLAK: 0,
          yesterdayBalanceLAK: 0,
          todayChangeLAK: 0,
          perCurrency: {},
          accountCount: 0,
          accounts: [],
        });
      }
      const co = coMap.get(cid)!;
      co.accountCount += 1;
      const rate = rates[r.currency] ?? 1;
      co.currentBalanceLAK += r.currentBalanceLAK;
      co.yesterdayBalanceLAK += r.yesterdayBalanceLAK;
      co.todayChangeLAK += r.todayChange * rate;
      const cur = co.perCurrency[r.currency] ?? {
        currency: r.currency,
        current: 0,
        yesterday: 0,
        change: 0,
      };
      cur.current += r.currentBalance;
      cur.yesterday += r.yesterdayBalance;
      cur.change += r.todayChange;
      co.perCurrency[r.currency] = cur;
      co.accounts.push({
        id: r.id,
        accountNumber: r.accountNumber,
        accountName: r.accountName,
        currency: r.currency,
        accountType: r.accountType,
        openingBalance: r.openingBalance,
        currentBalance: r.currentBalance,
        yesterdayBalance: r.yesterdayBalance,
        todayChange: r.todayChange,
        currentBalanceLAK: r.currentBalanceLAK,
        yesterdayBalanceLAK: r.yesterdayBalanceLAK,
        bank: r.bank,
      });
    }

    const companies = Array.from(coMap.values())
      .map((c) => ({
        ...c,
        perCurrency: Object.values(c.perCurrency).sort((a, b) => a.currency.localeCompare(b.currency)),
        accounts: c.accounts.sort(
          (a, b) =>
            a.bank.code.localeCompare(b.bank.code) ||
            a.currency.localeCompare(b.currency) ||
            a.accountNumber.localeCompare(b.accountNumber),
        ),
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    const totals = {
      todayLAK: companies.reduce((s, c) => s + c.currentBalanceLAK, 0),
      yesterdayLAK: companies.reduce((s, c) => s + c.yesterdayBalanceLAK, 0),
      deltaLAK: companies.reduce((s, c) => s + c.todayChangeLAK, 0),
    };

    return {
      accounts: accountRows,
      companies,
      totals,
      rates,
      asOf: now,
    };
  },
};
