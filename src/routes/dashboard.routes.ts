import { Router } from 'express';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();
router.use(authenticate);

type DateRangeQuery = {
  from?: string;
  to?: string;
  companyId?: string;
};

function parseDateRange(query: DateRangeQuery) {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const from = query.from ? new Date(query.from) : defaultFrom;
  const to = query.to ? new Date(query.to) : defaultTo;

  // Normalize to inclusive day boundaries
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

function buildBaseWhere(query: DateRangeQuery): Prisma.TransactionWhereInput {
  const { from, to } = parseDateRange(query);
  const where: Prisma.TransactionWhereInput = {
    transactionDate: { gte: from, lte: to },
    status: { notIn: [TransactionStatus.VOIDED, TransactionStatus.REJECTED, TransactionStatus.DRAFT] },
  };
  if (query.companyId) {
    where.companyId = query.companyId;
  }
  return where;
}

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const query = req.query as DateRangeQuery;
    const baseWhere = buildBaseWhere(query);

    const [
      companies,
      accounts,
      txnsToday,
      totalBalance,
      incomeAgg,
      expenseAgg,
      txnCount,
      companyList,
      perCompanyAgg,
      perCompanyBalances,
    ] = await Promise.all([
      prisma.company.count({ where: { isActive: true } }),
      prisma.bankAccount.count({ where: { isActive: true } }),
      prisma.transaction.count({
        where: {
          transactionDate: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
      prisma.bankAccount.aggregate({
        where: { isActive: true, accountType: { in: ['SAVINGS', 'CURRENT'] } },
        _sum: { currentBalance: true },
      }),
      prisma.transaction.aggregate({
        where: { ...baseWhere, type: TransactionType.INCOME },
        _sum: { amountInBase: true },
        _count: true,
      }),
      prisma.transaction.aggregate({
        where: { ...baseWhere, type: TransactionType.EXPENSE },
        _sum: { amountInBase: true },
        _count: true,
      }),
      prisma.transaction.count({ where: baseWhere }),
      prisma.company.findMany({
        where: { isActive: true, ...(query.companyId ? { id: query.companyId } : {}) },
        select: { id: true, code: true, name: true, nameEn: true },
        orderBy: { code: 'asc' },
      }),
      prisma.transaction.groupBy({
        by: ['companyId', 'type'],
        where: baseWhere,
        _sum: { amountInBase: true },
        _count: true,
      }),
      prisma.bankAccount.groupBy({
        by: ['companyId'],
        where: { isActive: true, accountType: { in: ['SAVINGS', 'CURRENT'] }, ...(query.companyId ? { companyId: query.companyId } : {}) },
        _sum: { currentBalance: true },
      }),
    ]);

    const totalIncome = Number(incomeAgg._sum.amountInBase ?? 0);
    const totalExpense = Number(expenseAgg._sum.amountInBase ?? 0);

    type CompanyStat = {
      id: string;
      code: string;
      name: string;
      nameEn: string | null;
      totalIncome: number;
      totalExpense: number;
      incomeCount: number;
      expenseCount: number;
      txnCount: number;
      usableBalance: number;
      netCashflow: number;
    };

    const companyStats = new Map<string, CompanyStat>(
      companyList.map((c) => [
        c.id,
        {
          id: c.id,
          code: c.code,
          name: c.name,
          nameEn: c.nameEn,
          totalIncome: 0,
          totalExpense: 0,
          incomeCount: 0,
          expenseCount: 0,
          txnCount: 0,
          usableBalance: 0,
          netCashflow: 0,
        },
      ]),
    );

    for (const g of perCompanyAgg) {
      const stat = companyStats.get(g.companyId);
      if (!stat) continue;
      const amt = Number(g._sum.amountInBase ?? 0);
      if (g.type === TransactionType.INCOME) {
        stat.totalIncome += amt;
        stat.incomeCount += g._count;
      } else if (g.type === TransactionType.EXPENSE) {
        stat.totalExpense += amt;
        stat.expenseCount += g._count;
      }
      stat.txnCount += g._count;
    }

    for (const b of perCompanyBalances) {
      const stat = companyStats.get(b.companyId);
      if (!stat) continue;
      stat.usableBalance = Number(b._sum.currentBalance ?? 0);
    }

    const companyBreakdown = Array.from(companyStats.values())
      .map((c) => ({ ...c, netCashflow: c.totalIncome - c.totalExpense }))
      .sort((a, b) => b.totalExpense - a.totalExpense);

    res.json({
      success: true,
      data: {
        companies,
        accounts,
        txnsToday,
        usableBalance: totalBalance._sum.currentBalance ?? 0,
        totalIncome,
        totalExpense,
        netCashflow: totalIncome - totalExpense,
        incomeCount: incomeAgg._count,
        expenseCount: expenseAgg._count,
        txnCount,
        companyBreakdown,
      },
    });
  }),
);

router.get(
  '/cash-position',
  asyncHandler(async (_req, res) => {
    const result = await prisma.bankAccount.groupBy({
      by: ['accountType', 'currency'],
      where: { isActive: true },
      _sum: { currentBalance: true },
      _count: true,
    });
    res.json({ success: true, data: result });
  }),
);

router.get(
  '/category-breakdown',
  asyncHandler(async (req, res) => {
    const query = req.query as DateRangeQuery & { type?: TransactionType };
    const baseWhere = buildBaseWhere(query);
    const type = query.type === TransactionType.EXPENSE ? TransactionType.EXPENSE : TransactionType.INCOME;

    const grouped = await prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { ...baseWhere, type },
      _sum: { amountInBase: true },
      _count: true,
    });

    const categoryIds = grouped.map((g) => g.categoryId).filter((id): id is string => Boolean(id));
    const categories = categoryIds.length
      ? await prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, code: true, name: true, nameEn: true, color: true, icon: true },
      })
      : [];
    const catMap = new Map(categories.map((c) => [c.id, c]));

    const total = grouped.reduce((acc, g) => acc + Number(g._sum.amountInBase ?? 0), 0);

    const data = grouped
      .map((g) => {
        const cat = g.categoryId ? catMap.get(g.categoryId) : undefined;
        const amount = Number(g._sum.amountInBase ?? 0);
        return {
          categoryId: g.categoryId,
          code: cat?.code ?? null,
          name: cat?.name ?? 'ບໍ່ໄດ້ກຳນົດໝວດ',
          nameEn: cat?.nameEn ?? null,
          color: cat?.color ?? null,
          icon: cat?.icon ?? null,
          amount,
          count: g._count,
          percentage: total > 0 ? (amount / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount);

    res.json({ success: true, data: { type, total, items: data } });
  }),
);

router.get(
  '/monthly-trend',
  asyncHandler(async (req, res) => {
    const query = req.query as DateRangeQuery & { months?: string };
    const months = Math.min(Math.max(parseInt(query.months ?? '6', 10) || 6, 1), 24);

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const where: Prisma.TransactionWhereInput = {
      transactionDate: { gte: start, lte: end },
      status: { notIn: [TransactionStatus.VOIDED, TransactionStatus.REJECTED, TransactionStatus.DRAFT] },
    };
    if (query.companyId) where.companyId = query.companyId;

    const rows = await prisma.transaction.findMany({
      where,
      select: { transactionDate: true, type: true, amountInBase: true },
    });

    const buckets = new Map<string, { month: string; income: number; expense: number }>();
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - (months - 1) + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, { month: key, income: 0, expense: 0 });
    }

    for (const r of rows) {
      const d = new Date(r.transactionDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const bucket = buckets.get(key);
      if (!bucket) continue;
      const amt = Number(r.amountInBase);
      if (r.type === TransactionType.INCOME) bucket.income += amt;
      else if (r.type === TransactionType.EXPENSE) bucket.expense += amt;
    }

    res.json({ success: true, data: Array.from(buckets.values()) });
  }),
);

router.get(
  '/recent-transactions',
  asyncHandler(async (req, res) => {
    const query = req.query as DateRangeQuery & { limit?: string };
    const limit = Math.min(Math.max(parseInt(query.limit ?? '10', 10) || 10, 1), 50);
    const recentWhere: Prisma.TransactionWhereInput = {
      status: { notIn: [TransactionStatus.VOIDED, TransactionStatus.REJECTED] },
    };
    if (query.companyId) recentWhere.companyId = query.companyId;
    const { from, to } = parseDateRange(query);
    if (query.from || query.to) {
      recentWhere.transactionDate = { gte: from, lte: to };
    }
    const items = await prisma.transaction.findMany({
      take: limit,
      orderBy: { transactionDate: 'desc' },
      where: recentWhere,
      select: {
        id: true,
        reference: true,
        transactionDate: true,
        type: true,
        amount: true,
        amountInBase: true,
        currency: true,
        description: true,
        company: { select: { id: true, code: true, name: true } },
        bankAccount: { select: { id: true, accountNumber: true, accountName: true } },
        category: { select: { id: true, code: true, name: true, color: true, icon: true } },
      },
    });
    res.json({ success: true, data: items });
  }),
);

router.get(
  '/category-types',
  asyncHandler(async (_req, res) => {
    const total = await prisma.category.count({ where: { isActive: true } });
    res.json({ success: true, data: { total } });
  }),
);
/*
router.get(
  '/daily-summary',
  asyncHandler(async (req, res) => {
    const query = req.query as { from?: string; to?: string; companyId?: string };
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const fromDate = query.from ? new Date(query.from) : defaultFrom;
    const toDate = query.to ? new Date(query.to) : defaultTo;
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    // 1. Fetch all bank accounts (for closing balance computation)
    const accountWhere: Prisma.BankAccountWhereInput = { isActive: true };
    if (query.companyId) accountWhere.companyId = query.companyId;
    const accounts = await prisma.bankAccount.findMany({
      where: accountWhere,
      select: {
        id: true,
        currency: true,
        accountType: true,
        currentBalance: true,
        companyId: true,
      },
    });

    // 2. Fetch all transactions from start of day to "now" (current real balance baseline)
    //    We need txns AFTER the report range to subtract them from currentBalance,
    //    and txns WITHIN the range to compute daily movements.
    const txnWhere: Prisma.TransactionWhereInput = {
      status: { notIn: [TransactionStatus.VOIDED, TransactionStatus.REJECTED, TransactionStatus.DRAFT] },
      bankAccountId: { in: accounts.map((a) => a.id) },
    };

    const allTxns = await prisma.transaction.findMany({
      where: txnWhere,
      select: {
        id: true,
        transactionDate: true,
        type: true,
        amount: true,
        currency: true,
        exchangeRate: true,
        amountInBase: true,
        bankAccountId: true,
      },
      orderBy: { transactionDate: 'asc' },
    });

    // Helper: format a Date to "YYYY-MM-DD" in local time
    const dayKey = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    // 3. Compute per-account opening balance at the START of the range:
    //    openingBalance(start) = currentBalance - sum(txns from start onwards signed)
    const accountOpening = new Map<string, number>();
    for (const a of accounts) {
      accountOpening.set(a.id, Number(a.currentBalance));
    }
    for (const t of allTxns) {
      const txnDate = new Date(t.transactionDate);
      if (txnDate >= fromDate) {
        // reverse this transaction from currentBalance to get opening
        const signed = t.type === TransactionType.INCOME ? Number(t.amount) : -Number(t.amount);
        const cur = accountOpening.get(t.bankAccountId) ?? 0;
        accountOpening.set(t.bankAccountId, cur - signed);
      }
    }

    // 4. Build list of all days in range
    const days: string[] = [];
    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      days.push(dayKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    // 5. Group transactions by date within range
    type DayMovement = {
      income: Record<string, number>;
      expense: Record<string, number>;
      rates: Record<string, { sum: number; count: number }>;
    };
    const movements = new Map<string, DayMovement>();
    for (const d of days) {
      movements.set(d, { income: {}, expense: {}, rates: {} });
    }
    for (const t of allTxns) {
      const txnDate = new Date(t.transactionDate);
      if (txnDate < fromDate || txnDate > toDate) continue;
      const k = dayKey(txnDate);
      const m = movements.get(k);
      if (!m) continue;
      const amt = Number(t.amount);
      if (t.type === TransactionType.INCOME) {
        m.income[t.currency] = (m.income[t.currency] ?? 0) + amt;
      } else if (t.type === TransactionType.EXPENSE) {
        m.expense[t.currency] = (m.expense[t.currency] ?? 0) + amt;
      }
      // Track exchange rates per currency (average over the day)
      if (t.currency !== 'LAK') {
        const r = m.rates[t.currency] ?? { sum: 0, count: 0 };
        r.sum += Number(t.exchangeRate);
        r.count += 1;
        m.rates[t.currency] = r;
      }
    }

    // 6. Walk forward day by day to compute running balances per account
    const runningBalances = new Map<string, number>(accountOpening);
    // Per-currency running rate (last known rate, defaulting to 1)
    const lastRates: Record<string, number> = { LAK: 1, THB: 1, USD: 1, CNY: 1, VND: 1 };
    // Initialize default exchange rates from the most recent ExchangeRate records to LAK
    const latestRates = await prisma.exchangeRate.findMany({
      where: { toCurrency: 'LAK', effectiveAt: { lte: toDate } },
      orderBy: { effectiveAt: 'desc' },
      take: 50,
    });
    const seenRates = new Set<string>();
    for (const r of latestRates) {
      if (seenRates.has(r.fromCurrency)) continue;
      seenRates.add(r.fromCurrency);
      lastRates[r.fromCurrency] = Number(r.rate);
    }

    const rows: {
      date: string;
      totalEquivLAK: number;
      usableLAK: number;
      stuckLAK: number;
      balances: Record<string, number>;
      income: Record<string, number>;
      expense: Record<string, number>;
      rates: Record<string, number>;
      checkVsPrev: number;
      checkIncomeExpense: number;
      fxDiff: number;
    }[] = [];

    let prevTotalEquivLAK = 0;

    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const move = movements.get(d)!;

      // Update running balances by today's movements
      for (const t of allTxns) {
        if (dayKey(new Date(t.transactionDate)) !== d) continue;
        const signed = t.type === TransactionType.INCOME ? Number(t.amount) : -Number(t.amount);
        const cur = runningBalances.get(t.bankAccountId) ?? 0;
        runningBalances.set(t.bankAccountId, cur + signed);
      }

      // Update lastRates from today's transactions (if any)
      for (const [curCode, agg] of Object.entries(move.rates)) {
        if (agg.count > 0) lastRates[curCode] = agg.sum / agg.count;
      }

      // Aggregate balances per currency + per account type
      const balancesByCurrency: Record<string, number> = {};
      let usableLAKEquiv = 0;
      let stuckLAKEquiv = 0;
      for (const a of accounts) {
        const bal = runningBalances.get(a.id) ?? 0;
        balancesByCurrency[a.currency] = (balancesByCurrency[a.currency] ?? 0) + bal;
        const rate = lastRates[a.currency] || 1;
        const equiv = bal * rate;
        if (a.accountType !== 'FIXED_DEPOSIT') usableLAKEquiv += equiv;
        else stuckLAKEquiv += equiv;
      }
      const totalEquivLAK = usableLAKEquiv + stuckLAKEquiv;

      // Cross-check: compare totalEquivLAK with previous day + today's net (in LAK equiv)
      let todaysNetLAK = 0;
      for (const [c, v] of Object.entries(move.income)) {
        todaysNetLAK += v * (lastRates[c] || 1);
      }
      for (const [c, v] of Object.entries(move.expense)) {
        todaysNetLAK -= v * (lastRates[c] || 1);
      }
      const checkVsPrev = i === 0 ? totalEquivLAK : totalEquivLAK - (prevTotalEquivLAK + todaysNetLAK);

      // Cross-check: income - expense for the day in LAK equiv
      const checkIncomeExpense = todaysNetLAK;

      // FX difference: change in total not explained by movements
      let fxDiff = 0;
      if (i > 0) {
        const movementSumLAK = todaysNetLAK;
        const balanceDelta = totalEquivLAK - prevTotalEquivLAK;
        fxDiff = balanceDelta - movementSumLAK;
      }

      rows.push({
        date: d,
        totalEquivLAK,
        usableLAK: usableLAKEquiv,
        stuckLAK: stuckLAKEquiv,
        balances: balancesByCurrency,
        income: move.income,
        expense: move.expense,
        rates: { ...lastRates },
        checkVsPrev,
        checkIncomeExpense,
        fxDiff,
      });

      prevTotalEquivLAK = totalEquivLAK;
    }

    // Discover all currencies actually used in the range (so columns are stable)
    const currencySet = new Set<string>();
    for (const a of accounts) currencySet.add(a.currency);
    for (const t of allTxns) currencySet.add(t.currency);
    if (currencySet.size === 0) currencySet.add('LAK');

    res.json({
      success: true,
      data: {
        from: fromDate,
        to: toDate,
        currencies: Array.from(currencySet),
        rows,
      },
    });
  }),
);*/
router.get(
  '/daily-summary',
  asyncHandler(async (req, res) => {
    const query = req.query as {
      from?: string;
      to?: string;
      companyId?: string;
    };

    const now = new Date();

    const defaultFrom = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    );

    const defaultTo = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const fromDate = query.from
      ? new Date(query.from)
      : defaultFrom;

    const toDate = query.to
      ? new Date(query.to)
      : defaultTo;

    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    // Never show future days — cap toDate to end of today
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    if (toDate > endOfToday) {
      toDate.setTime(endOfToday.getTime());
    }

    const round2 = (n: number) =>
      Math.round((n + Number.EPSILON) * 100) / 100;

    // =====================================================
    // 1. BANK ACCOUNTS
    // =====================================================

    const accountWhere: Prisma.BankAccountWhereInput = {
      isActive: true,
    };

    if (query.companyId) {
      accountWhere.companyId = query.companyId;
    }

    const accounts = await prisma.bankAccount.findMany({
      where: accountWhere,
      select: {
        id: true,
        currency: true,
        accountType: true,
        companyId: true,
        currentBalance: true,
      },
    });

    // =====================================================
    // 2. ALL TRANSACTIONS FROM fromDate ONWARDS
    //    (no upper bound — needed to rewind currentBalance
    //     back to the opening balance at fromDate)
    // =====================================================

    const allTxnsFromStart = await prisma.transaction.findMany({
      where: {
        status: {
          notIn: [
            TransactionStatus.VOIDED,
            TransactionStatus.REJECTED,
            TransactionStatus.DRAFT,
          ],
        },
        bankAccountId: {
          in: accounts.map((a) => a.id),
        },
        transactionDate: {
          gte: fromDate,
        },
      },
      select: {
        id: true,
        transactionDate: true,
        type: true,
        amount: true,
        currency: true,
        exchangeRate: true,
        amountInBase: true,
        bankAccountId: true,
        companyId: true,
        company: { select: { id: true, code: true, name: true } },
      },
      orderBy: {
        transactionDate: 'asc',
      },
    });

    // Only in-range transactions are used for movements / company breakdown
    const txns = allTxnsFromStart.filter(
      (t) => new Date(t.transactionDate) <= toDate,
    );

    // =====================================================
    // 3. DATE HELPER
    // =====================================================

    const dayKey = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');

      return `${y}-${m}-${day}`;
    };

    // =====================================================
    // 4. ALL DAYS
    // =====================================================

    const days: string[] = [];

    const cursor = new Date(fromDate);

    while (cursor <= toDate) {
      days.push(dayKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    // =====================================================
    // 5. LATEST EXCHANGE RATES (stored as fromCurrency → LAK)
    // =====================================================

    const lastRates: Record<string, number> = {
      LAK: 1,
    };

    const latestRates = await prisma.exchangeRate.findMany({
      where: {
        toCurrency: 'LAK',
        effectiveAt: {
          lte: toDate,
        },
      },
      orderBy: {
        effectiveAt: 'desc',
      },
      take: 50,
    });

    const seenRates = new Set<string>();

    for (const r of latestRates) {
      if (seenRates.has(r.fromCurrency)) continue;
      seenRates.add(r.fromCurrency);
      // rate represents: 1 unit of fromCurrency = rate units of LAK
      lastRates[r.fromCurrency] = Number(r.rate);
    }

    // =====================================================
    // 6. OPENING BALANCES (rewind currentBalance to start of range)
    //    openingBalance[acct] = currentBalance
    //                           - sum(all txns from fromDate onwards, signed)
    // =====================================================

    const accountOpening = new Map<string, number>();
    for (const a of accounts) {
      accountOpening.set(a.id, Number(a.currentBalance));
    }
    for (const t of allTxnsFromStart) {
      const signed =
        t.type === TransactionType.INCOME
          ? Number(t.amount)
          : -Number(t.amount);
      const cur = accountOpening.get(t.bankAccountId) ?? 0;
      accountOpening.set(t.bankAccountId, cur - signed);
    }

    // Running balance starts from the opening value and walks forward day by day.
    const runningBalances = new Map<string, number>(accountOpening);

    // =====================================================
    // 6b. NON-FINANCIAL ITEMS (withheld / unusable)
    //     Static totals shown on every row as informational columns.
    // =====================================================

    const nfiItems = await prisma.nonFinancialItem.findMany({
      where: { bankAccountId: { in: accounts.map((a) => a.id) } },
      select: { type: true, amount: true, currency: true },
    });

    let withheldLAKTotal = 0;
    let unusableLAKTotal = 0;
    for (const item of nfiItems) {
      const rate = lastRates[item.currency ?? 'LAK'] || 1;
      const amtLAK = Number(item.amount) * rate;
      if (item.type === 'WITHHELD') withheldLAKTotal += amtLAK;
      else if (item.type === 'UNUSABLE') unusableLAKTotal += amtLAK;
    }
    const withheldLAKRounded = round2(withheldLAKTotal);
    const unusableLAKRounded = round2(unusableLAKTotal);

    // =====================================================
    // 7. BUILD DAILY ROWS
    // =====================================================

    type CompanyDayCell = {
      incomeLAK: number;
      expenseLAK: number;
      netLAK: number;
      txnCount: number;
      usableLAK: number;
      stuckLAK: number;
      balances: Record<string, number>;
    };

    const rows: {
      date: string;
      totalEquivLAK: number;
      usableLAK: number;
      stuckLAK: number;
      withheldLAK: number;
      unusableLAK: number;
      balances: Record<string, number>;
      income: Record<string, number>;
      expense: Record<string, number>;
      rates: Record<string, number>;
      checkVsPrev: number;
      checkIncomeExpense: number;
      fxDiff: number;
      companies: Record<string, CompanyDayCell>;
    }[] = [];

    // Track distinct companies seen during the range so the frontend can render stable columns.
    const companyMeta = new Map<string, { companyId: string | null; code: string; name: string }>();
    const noCompanyKey = '__none__';

    // Group in-range txns by day key for O(days) lookup instead of O(days×txns)
    const txnsByDay = new Map<string, typeof txns>();
    for (const t of txns) {
      const k = dayKey(new Date(t.transactionDate));
      if (!txnsByDay.has(k)) txnsByDay.set(k, []);
      txnsByDay.get(k)!.push(t);
    }

    let prevTotalEquivLAK = 0;

    for (let i = 0; i < days.length; i++) {
      const d = days[i];

      // ---------------------------------------------
      // TXNS OF THIS DAY ONLY
      // ---------------------------------------------

      const dayTxns = txnsByDay.get(d) ?? [];

      // ---------------------------------------------
      // STEP 1: Update exchange rates from today's txns
      // ---------------------------------------------

      for (const t of dayTxns) {
        if (t.currency !== 'LAK' && Number(t.exchangeRate) > 0) {
          lastRates[t.currency] = Number(t.exchangeRate);
        }
      }

      // ---------------------------------------------
      // STEP 2: Update runningBalances + collect
      //         daily income/expense/company data
      // ---------------------------------------------

      const income: Record<string, number> = {};
      const expense: Record<string, number> = {};
      const companies: Record<string, CompanyDayCell> = {};
      let todaysNetLAK = 0;

      for (const t of dayTxns) {
        const amount = Number(t.amount);
        const currency = t.currency;
        const rate = lastRates[currency] || 1;
        const signed = t.type === TransactionType.INCOME ? amount : -amount;

        // Update running balance for this account
        runningBalances.set(
          t.bankAccountId,
          (runningBalances.get(t.bankAccountId) ?? 0) + signed,
        );

        // income / expense columns
        if (t.type === TransactionType.INCOME) {
          income[currency] = (income[currency] ?? 0) + amount;
          todaysNetLAK += amount * rate;
        } else if (t.type === TransactionType.EXPENSE) {
          expense[currency] = (expense[currency] ?? 0) + amount;
          todaysNetLAK -= amount * rate;
        }

        // per-company per-day breakdown
        const coKey = t.company?.id ?? noCompanyKey;
        if (!companyMeta.has(coKey)) {
          companyMeta.set(coKey, {
            companyId: t.company?.id ?? null,
            code: t.company?.code ?? '-',
            name: t.company?.name ?? 'ບໍ່ໄດ້ກຳນົດບໍລິສັດ',
          });
        }
        const coCell = companies[coKey] ?? { incomeLAK: 0, expenseLAK: 0, netLAK: 0, txnCount: 0, usableLAK: 0, stuckLAK: 0, balances: {} };
        const amountLAK = amount * rate;
        if (t.type === TransactionType.INCOME) {
          coCell.incomeLAK += amountLAK;
          coCell.netLAK += amountLAK;
        } else if (t.type === TransactionType.EXPENSE) {
          coCell.expenseLAK += amountLAK;
          coCell.netLAK -= amountLAK;
        }
        coCell.txnCount += 1;
        companies[coKey] = coCell;
      }

      // ---------------------------------------------
      // STEP 3: Aggregate runningBalances per currency
      //         → this is the CLOSING balance for the day
      // ---------------------------------------------

      const balances: Record<string, number> = {};
      let usableLAK = 0;
      let stuckLAK = 0;

      // Per-company balance aggregation
      const companyBals: Record<string, { usableLAK: number; stuckLAK: number; balances: Record<string, number> }> = {};

      for (const a of accounts) {
        const bal = runningBalances.get(a.id) ?? 0;
        balances[a.currency] = (balances[a.currency] ?? 0) + bal;
        const rate = lastRates[a.currency] || 1;
        const equiv = bal * rate;
        if (a.accountType !== 'FIXED_DEPOSIT') {
          usableLAK += equiv;
        } else {
          stuckLAK += equiv;
        }

        // Accumulate per-company
        const coKey = a.companyId ?? noCompanyKey;
        if (!companyBals[coKey]) companyBals[coKey] = { usableLAK: 0, stuckLAK: 0, balances: {} };
        companyBals[coKey].balances[a.currency] = (companyBals[coKey].balances[a.currency] ?? 0) + bal;
        if (a.accountType !== 'FIXED_DEPOSIT') companyBals[coKey].usableLAK += equiv;
        else companyBals[coKey].stuckLAK += equiv;
      }

      // Merge company balance data into company cells
      for (const k of Object.keys(companies)) {
        const c = companies[k];
        const cb = companyBals[k] ?? { usableLAK: 0, stuckLAK: 0, balances: {} };
        companies[k] = {
          incomeLAK: round2(c.incomeLAK),
          expenseLAK: round2(c.expenseLAK),
          netLAK: round2(c.netLAK),
          txnCount: c.txnCount,
          usableLAK: round2(cb.usableLAK),
          stuckLAK: round2(cb.stuckLAK),
          balances: cb.balances,
        };
      }

      const totalEquivLAK = usableLAK + stuckLAK;

      // ---------------------------------------------
      // STEP 4: Cross-check fields
      // ---------------------------------------------

      const checkIncomeExpense = round2(todaysNetLAK);

      // checkVsPrev: difference between today's total and (prev + today's movements).
      // Non-zero means FX rate change affected the LAK equivalent of existing balances.
      const checkVsPrev = i === 0
        ? 0
        : round2(totalEquivLAK - prevTotalEquivLAK - todaysNetLAK);

      const fxDiff = i === 0
        ? 0
        : round2(totalEquivLAK - prevTotalEquivLAK - todaysNetLAK);

      // ---------------------------------------------
      // PUSH
      // ---------------------------------------------

      rows.push({
        date: d,
        totalEquivLAK: round2(totalEquivLAK),
        usableLAK: round2(usableLAK),
        stuckLAK: round2(stuckLAK),
        withheldLAK: withheldLAKRounded,
        unusableLAK: unusableLAKRounded,
        balances,
        income,
        expense,
        rates: { ...lastRates },
        checkVsPrev,
        checkIncomeExpense,
        fxDiff,
        companies,
      });

      prevTotalEquivLAK = totalEquivLAK;
    }

    // =====================================================
    // 7. CURRENCIES
    // =====================================================

    const currencySet = new Set<string>();

    for (const a of accounts) {
      currencySet.add(a.currency);
    }

    for (const t of txns) {
      currencySet.add(t.currency);
    }

    if (currencySet.size === 0) {
      currencySet.add('LAK');
    }

    // =====================================================
    // 8. COMPANY SUMMARY (across the entire range, LAK-equivalent)
    // =====================================================

    type CompanyDailySum = {
      companyId: string | null;
      code: string;
      name: string;
      totalIncome: Record<string, number>;
      totalExpense: Record<string, number>;
      totalIncomeLAK: number;
      totalExpenseLAK: number;
      txnCount: number;
    };

    const coMap = new Map<string, CompanyDailySum>();
    for (const t of txns) {
      const key = t.company?.id ?? '__none__';
      if (!coMap.has(key)) {
        coMap.set(key, {
          companyId: t.company?.id ?? null,
          code: t.company?.code ?? '-',
          name: t.company?.name ?? 'ບໍ່ໄດ້ກຳນົດບໍລິສັດ',
          totalIncome: {},
          totalExpense: {},
          totalIncomeLAK: 0,
          totalExpenseLAK: 0,
          txnCount: 0,
        });
      }
      const entry = coMap.get(key)!;
      const amt = Number(t.amount);
      const rate = lastRates[t.currency] || 1;
      entry.txnCount += 1;
      if (t.type === TransactionType.INCOME) {
        entry.totalIncome[t.currency] = (entry.totalIncome[t.currency] ?? 0) + amt;
        entry.totalIncomeLAK += amt * rate;
      } else if (t.type === TransactionType.EXPENSE) {
        entry.totalExpense[t.currency] = (entry.totalExpense[t.currency] ?? 0) + amt;
        entry.totalExpenseLAK += amt * rate;
      }
    }

    const companySummary = Array.from(coMap.values())
      .map((c) => ({
        ...c,
        totalIncomeLAK: round2(c.totalIncomeLAK),
        totalExpenseLAK: round2(c.totalExpenseLAK),
        netCashflowLAK: round2(c.totalIncomeLAK - c.totalExpenseLAK),
      }))
      .sort((a, b) => b.totalExpenseLAK - a.totalExpenseLAK);

    // =====================================================
    // RESPONSE
    // =====================================================

    // Stable list of companies seen in the range (for daily-table columns).
    const companies = Array.from(companyMeta.entries())
      .map(([key, meta]) => ({ key, ...meta }))
      .sort((a, b) => a.code.localeCompare(b.code));

    res.json({
      success: true,
      data: {
        from: fromDate,
        to: toDate,
        currencies: Array.from(currencySet),
        rows,
        companySummary,
        companies,
      },
    });
  }),
);

router.get(
  '/monthly-report',
  asyncHandler(async (req, res) => {
    const query = req.query as { year?: string; month?: string; companyId?: string };
    const now = new Date();
    const year = parseInt(query.year ?? `${now.getFullYear()}`, 10) || now.getFullYear();
    const month = parseInt(query.month ?? `${now.getMonth() + 1}`, 10) || now.getMonth() + 1;

    const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const to = new Date(year, month, 0, 23, 59, 59, 999);

    const where: Prisma.TransactionWhereInput = {
      transactionDate: { gte: from, lte: to },
      status: { notIn: [TransactionStatus.VOIDED, TransactionStatus.REJECTED, TransactionStatus.DRAFT] },
    };
    if (query.companyId) where.companyId = query.companyId;

    const txns = await prisma.transaction.findMany({
      where,
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        reference: true,
        transactionDate: true,
        type: true,
        amount: true,
        currency: true,
        exchangeRate: true,
        amountInBase: true,
        description: true,
        note: true,
        company: { select: { id: true, code: true, name: true } },
        bankAccount: { select: { id: true, accountNumber: true, accountName: true } },
        category: { select: { id: true, code: true, name: true } },
        subCategory: { select: { id: true, code: true, name: true } },
      },
    });

    type CurrencyTotals = Record<string, number>;
    type SubCatRow = { subCategoryId: string | null; name: string; totals: CurrencyTotals; count: number };
    type CatRow = {
      categoryId: string | null;
      name: string;
      txnType: 'INCOME' | 'EXPENSE';
      totals: CurrencyTotals;
      count: number;
      subCategories: Map<string, SubCatRow>;
    };

    const incomeCats = new Map<string, CatRow>();
    const expenseCats = new Map<string, CatRow>();
    const grandTotals: { income: CurrencyTotals; expense: CurrencyTotals } = {
      income: {},
      expense: {},
    };

    for (const t of txns) {
      if (t.type === TransactionType.TRANSFER) continue;
      const isIncome = t.type === TransactionType.INCOME;
      const catBucket = isIncome ? incomeCats : expenseCats;
      const grandBucket = isIncome ? grandTotals.income : grandTotals.expense;

      const catKey = t.category?.id ?? '__none__';
      const catName = t.category?.name ?? 'ບໍ່ໄດ້ກຳນົດໝວດ';
      const subKey = t.subCategory?.id ?? '__none__';
      const subName = t.subCategory?.name ?? '';

      if (!catBucket.has(catKey)) {
        catBucket.set(catKey, {
          categoryId: t.category?.id ?? null,
          name: catName,
          txnType: isIncome ? 'INCOME' : 'EXPENSE',
          totals: {},
          count: 0,
          subCategories: new Map(),
        });
      }
      const cat = catBucket.get(catKey)!;
      const amt = Number(t.amount);
      cat.totals[t.currency] = (cat.totals[t.currency] ?? 0) + amt;
      cat.count += 1;
      grandBucket[t.currency] = (grandBucket[t.currency] ?? 0) + amt;

      if (!cat.subCategories.has(subKey)) {
        cat.subCategories.set(subKey, {
          subCategoryId: t.subCategory?.id ?? null,
          name: subName,
          totals: {},
          count: 0,
        });
      }
      const sub = cat.subCategories.get(subKey)!;
      sub.totals[t.currency] = (sub.totals[t.currency] ?? 0) + amt;
      sub.count += 1;
    }

    const serializeCat = (c: CatRow) => ({
      categoryId: c.categoryId,
      name: c.name,
      txnType: c.txnType,
      totals: c.totals,
      count: c.count,
      subCategories: Array.from(c.subCategories.values()).map((s) => ({
        subCategoryId: s.subCategoryId,
        name: s.name,
        totals: s.totals,
        count: s.count,
      })),
    });

    res.json({
      success: true,
      data: {
        year,
        month,
        from,
        to,
        transactions: txns,
        summary: {
          income: Array.from(incomeCats.values()).map(serializeCat),
          expense: Array.from(expenseCats.values()).map(serializeCat),
          totals: grandTotals,
        },
      },
    });
  }),
);

router.get(
  '/category-type-summary',
  asyncHandler(async (req, res) => {
    const query = req.query as DateRangeQuery;
    const baseWhere = buildBaseWhere(query);

    const grouped = await prisma.transaction.groupBy({
      by: ['type'],
      where: baseWhere,
      _sum: { amountInBase: true },
      _count: true,
    });

    type Bucket = { key: string; label: string; amount: number; count: number };
    const totals: Record<string, Bucket> = {
      INCOME: { key: 'INCOME', label: 'ໂອນເຂົ້າ', amount: 0, count: 0 },
      EXPENSE: { key: 'EXPENSE', label: 'ໂອນອອກ', amount: 0, count: 0 },
      TRANSFER: { key: 'TRANSFER', label: 'ໂອນ', amount: 0, count: 0 },
    };

    for (const g of grouped) {
      const amount = Number(g._sum.amountInBase ?? 0);
      const key = g.type as string;
      if (totals[key]) {
        totals[key].amount += amount;
        totals[key].count += g._count;
      }
    }

    const totalAmount = Object.values(totals).reduce((sum, b) => sum + b.amount, 0);
    const items = Object.values(totals).map((b) => ({
      ...b,
      percentage: totalAmount > 0 ? (b.amount / totalAmount) * 100 : 0,
    }));

    res.json({ success: true, data: { total: totalAmount, items } });
  }),
);

// ──────────────────────────────────────────────────────────────
// Sheet-view endpoints for the 7-tab Reports UI
// ──────────────────────────────────────────────────────────────

// Sheet 2: Master Ledger — transactions with per-account running balance
router.get(
  '/sheet-master-ledger',
  asyncHandler(async (req, res) => {
    const query = req.query as DateRangeQuery;
    const { from, to } = parseDateRange(query);

    const [accounts, latestRates] = await Promise.all([
      prisma.bankAccount.findMany({
        where: { isActive: true, ...(query.companyId ? { companyId: query.companyId } : {}) },
        include: { bank: true, company: true },
        orderBy: [{ company: { code: 'asc' } }, { bank: { code: 'asc' } }],
      }),
      prisma.exchangeRate.findMany({
        where: { toCurrency: 'LAK', effectiveAt: { lte: to } },
        orderBy: { effectiveAt: 'desc' },
        take: 50,
      }),
    ]);

    const rates: Record<string, number> = { LAK: 1, THB: 660, USD: 21500 };
    const seen = new Set<string>();
    for (const r of latestRates) {
      if (!seen.has(r.fromCurrency)) { seen.add(r.fromCurrency); rates[r.fromCurrency] = Number(r.rate); }
    }

    const txns = await prisma.transaction.findMany({
      where: {
        transactionDate: { gte: from, lte: to },
        status: { in: ['POSTED', 'APPROVED'] },
        ...(query.companyId ? { companyId: query.companyId } : {}),
      },
      include: { company: true, bankAccount: { include: { bank: true } }, category: true },
      orderBy: { transactionDate: 'asc' },
    });

    // Build account columns (sorted same as export service)
    const acctCols = accounts.map((a) => ({
      id: a.id,
      bankCode: a.bank.code,
      accountName: a.accountName,
      currency: a.currency,
      companyName: a.company.name,
    }));
    acctCols.sort(
      (a, b) =>
        a.bankCode.localeCompare(b.bankCode) ||
        a.currency.localeCompare(b.currency) ||
        a.accountName.localeCompare(b.accountName),
    );

    const acctIdx = new Map<string, number>(acctCols.map((a, i) => [a.id, i]));
    const balance: number[] = new Array(acctCols.length).fill(0);

    const rows = txns
      .filter((t) => acctIdx.has(t.bankAccountId))
      .map((t) => {
        const i = acctIdx.get(t.bankAccountId)!;
        const amt = Number(t.amount);
        if (t.type === TransactionType.INCOME) balance[i] += amt;
        else if (t.type === TransactionType.EXPENSE) balance[i] -= amt;
        return {
          id: t.id,
          date: t.transactionDate,
          description: t.description,
          company: t.company ? { id: t.company.id, code: t.company.code, name: t.company.name } : null,
          type: t.type,
          amount: Number(t.amount),
          currency: t.currency,
          accountIdx: i,
          balanceSnapshot: [...balance],
        };
      });

    type CompanySum = {
      companyId: string | null;
      code: string;
      name: string;
      totalIncome: number;
      totalExpense: number;
      totalIncomeLAK: number;
      totalExpenseLAK: number;
      txnCount: number;
    };
    const companyMap = new Map<string, CompanySum>();
    for (const t of txns) {
      const cid = t.company?.id ?? '__none__';
      if (!companyMap.has(cid)) {
        companyMap.set(cid, {
          companyId: t.company?.id ?? null,
          code: t.company?.code ?? '-',
          name: t.company?.name ?? 'ບໍ່ໄດ້ກຳນົດບໍລິສັດ',
          totalIncome: 0,
          totalExpense: 0,
          totalIncomeLAK: 0,
          totalExpenseLAK: 0,
          txnCount: 0,
        });
      }
      const stat = companyMap.get(cid)!;
      const amt = Number(t.amount);
      const rate = rates[t.currency] ?? 1;
      stat.txnCount += 1;
      if (t.type === TransactionType.INCOME) {
        stat.totalIncome += amt;
        stat.totalIncomeLAK += amt * rate;
      } else if (t.type === TransactionType.EXPENSE) {
        stat.totalExpense += amt;
        stat.totalExpenseLAK += amt * rate;
      }
    }
    const companySummary = Array.from(companyMap.values())
      .map((c) => ({
        ...c,
        totalIncomeLAK: Math.round(c.totalIncomeLAK * 100) / 100,
        totalExpenseLAK: Math.round(c.totalExpenseLAK * 100) / 100,
        netCashflowLAK: Math.round((c.totalIncomeLAK - c.totalExpenseLAK) * 100) / 100,
      }))
      .sort((a, b) => b.totalExpenseLAK - a.totalExpenseLAK);

    // Per-day per-company breakdown (LAK-equivalent)
    const dayKey = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    type DayCompanyCell = {
      incomeLAK: number;
      expenseLAK: number;
      netLAK: number;
      txnCount: number;
    };
    const dailyByCompanyMap = new Map<string, Map<string, DayCompanyCell>>();
    const companyKeysSeen = new Map<string, { companyId: string | null; code: string; name: string }>();

    for (const t of txns) {
      if (!acctIdx.has(t.bankAccountId)) continue;
      const day = dayKey(t.transactionDate);
      const coKey = t.company?.id ?? '__none__';
      if (!companyKeysSeen.has(coKey)) {
        companyKeysSeen.set(coKey, {
          companyId: t.company?.id ?? null,
          code: t.company?.code ?? '-',
          name: t.company?.name ?? 'ບໍ່ໄດ້ກຳນົດບໍລິສັດ',
        });
      }
      if (!dailyByCompanyMap.has(day)) dailyByCompanyMap.set(day, new Map());
      const dayMap = dailyByCompanyMap.get(day)!;
      const cell = dayMap.get(coKey) ?? { incomeLAK: 0, expenseLAK: 0, netLAK: 0, txnCount: 0 };
      const amt = Number(t.amount);
      const rate = rates[t.currency] ?? 1;
      const amtLAK = amt * rate;
      cell.txnCount += 1;
      if (t.type === TransactionType.INCOME) {
        cell.incomeLAK += amtLAK;
        cell.netLAK += amtLAK;
      } else if (t.type === TransactionType.EXPENSE) {
        cell.expenseLAK += amtLAK;
        cell.netLAK -= amtLAK;
      }
      dayMap.set(coKey, cell);
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const dailyByCompany = Array.from(dailyByCompanyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, coMap]) => ({
        date,
        companies: Array.from(coMap.entries())
          .map(([key, cell]) => {
            const meta = companyKeysSeen.get(key)!;
            return {
              key,
              companyId: meta.companyId,
              code: meta.code,
              name: meta.name,
              incomeLAK: round2(cell.incomeLAK),
              expenseLAK: round2(cell.expenseLAK),
              netLAK: round2(cell.netLAK),
              txnCount: cell.txnCount,
            };
          })
          .sort((a, b) => b.expenseLAK - a.expenseLAK),
      }));

    res.json({
      success: true,
      data: {
        accounts: acctCols,
        rates,
        rows,
        totals: { balance: [...balance] },
        companySummary,
        dailyByCompany,
      },
    });
  }),
);

// Sheet 7: Stuck Assets — STUCK/COLLATERAL accounts with LAK equivalent
router.get(
  '/sheet-stuck-assets',
  asyncHandler(async (req, res) => {
    const query = req.query as DateRangeQuery;
    const { to } = parseDateRange(query);

    const [accounts, latestRates] = await Promise.all([
      prisma.bankAccount.findMany({
        where: {
          isActive: true,
          accountType: 'FIXED_DEPOSIT',
          ...(query.companyId ? { companyId: query.companyId } : {}),
        },
        include: { bank: true, company: true },
        orderBy: [{ company: { code: 'asc' } }, { bank: { code: 'asc' } }],
      }),
      prisma.exchangeRate.findMany({
        where: { toCurrency: 'LAK', effectiveAt: { lte: to } },
        orderBy: { effectiveAt: 'desc' },
        take: 50,
      }),
    ]);

    const rates: Record<string, number> = { LAK: 1, THB: 660, USD: 21500 };
    const seen = new Set<string>();
    for (const r of latestRates) {
      if (!seen.has(r.fromCurrency)) { seen.add(r.fromCurrency); rates[r.fromCurrency] = Number(r.rate); }
    }

    let totalLAK = 0;
    const items = accounts.map((a) => {
      const amt = Number(a.currentBalance);
      const lak = Math.round(amt * (rates[a.currency] ?? 1) * 100) / 100;
      totalLAK += lak;
      return {
        id: a.id,
        accountName: a.accountName,
        accountNumber: a.accountNumber,
        accountType: a.accountType,
        currency: a.currency,
        balance: amt,
        balanceLAK: lak,
        bankCode: a.bank.code,
        bankName: a.bank.name,
        companyName: a.company.name,
      };
    });

    res.json({ success: true, data: { rates, items, totalLAK: Math.round(totalLAK * 100) / 100 } });
  }),
);

// Sheet 8: Fund — FUND account transactions with running balance
router.get(
  '/sheet-fund',
  asyncHandler(async (req, res) => {
    const query = req.query as DateRangeQuery;
    const { from, to } = parseDateRange(query);

    const [fundAccounts, latestRates] = await Promise.all([
      prisma.bankAccount.findMany({
        where: {
          isActive: true,
          OR: [
            { accountType: 'FIXED_DEPOSIT' },
            { accountName: { contains: 'ກອງທຶນ' } },
            { accountName: { contains: 'yamamoto', mode: 'insensitive' } },
          ],
          ...(query.companyId ? { companyId: query.companyId } : {}),
        },
        include: { bank: true, company: true },
      }),
      prisma.exchangeRate.findMany({
        where: { toCurrency: 'LAK', effectiveAt: { lte: to } },
        orderBy: { effectiveAt: 'desc' },
        take: 50,
      }),
    ]);

    const rates: Record<string, number> = { LAK: 1, THB: 660, USD: 21500 };
    const seen = new Set<string>();
    for (const r of latestRates) {
      if (!seen.has(r.fromCurrency)) { seen.add(r.fromCurrency); rates[r.fromCurrency] = Number(r.rate); }
    }

    const fundIds = fundAccounts.map((a) => a.id);
    const txns = await prisma.transaction.findMany({
      where: {
        transactionDate: { gte: from, lte: to },
        status: { in: ['POSTED', 'APPROVED'] },
        bankAccountId: { in: fundIds },
      },
      include: { company: true, bankAccount: { include: { bank: true } } },
      orderBy: { transactionDate: 'asc' },
    });

    let running = 0;
    const rows = txns.map((t) => {
      const amt = Number(t.amount);
      const sign = t.type === TransactionType.INCOME ? 1 : -1;
      const lak = Math.round(amt * (rates[t.currency] ?? 1) * sign * 100) / 100;
      running += lak;
      return {
        id: t.id,
        date: t.transactionDate,
        description: t.description,
        currency: t.currency,
        amount: amt,
        amountLAK: lak,
        type: t.type,
        runningBalance: Math.round(running * 100) / 100,
      };
    });

    res.json({ success: true, data: { rates, rows, totalBalance: Math.round(running * 100) / 100 } });
  }),
);

// Sheet 10: Ministry 5% — ODSc account ledger
router.get(
  '/sheet-ministry',
  asyncHandler(async (req, res) => {
    const query = req.query as DateRangeQuery;
    const { from, to } = parseDateRange(query);

    const account = await prisma.bankAccount.findFirst({
      where: {
        isActive: true,
        OR: [
          { accountName: { contains: 'ກະຊວງ' } },
          { accountName: { contains: '5%' } },
          { accountName: { contains: 'odsc', mode: 'insensitive' } },
        ],
        ...(query.companyId ? { companyId: query.companyId } : {}),
      },
      include: { bank: true, company: true },
    });

    const txns = account
      ? await prisma.transaction.findMany({
          where: {
            transactionDate: { gte: from, lte: to },
            status: { in: ['POSTED', 'APPROVED'] },
            bankAccountId: account.id,
          },
          orderBy: { transactionDate: 'asc' },
        })
      : [];

    const opening = account ? Number(account.openingBalance) : 0;
    let bal = opening;
    const rows = txns.map((t, i) => {
      const out = t.type === TransactionType.EXPENSE ? Number(t.amount) : 0;
      bal -= out;
      return {
        seq: i + 1,
        id: t.id,
        date: t.transactionDate,
        description: t.description,
        expense: out || null,
        balance: Math.round(bal * 100) / 100,
        note: t.note ?? '',
      };
    });

    res.json({
      success: true,
      data: {
        account: account
          ? { id: account.id, accountName: account.accountName, bankCode: account.bank.code }
          : null,
        opening,
        rows,
        closing: Math.round(bal * 100) / 100,
      },
    });
  }),
);

// Sheet 11: Debts — LAK side (BCEL) and USD side (JDB) dual-column
router.get(
  '/sheet-debts',
  asyncHandler(async (req, res) => {
    const query = req.query as DateRangeQuery;
    const { from, to } = parseDateRange(query);

    const targetCompanies = await prisma.company.findMany({
      where: {
        OR: [
          { name: { contains: 'ພາຈ່າຍ', mode: 'insensitive' } },
          { name: { contains: 'phajay', mode: 'insensitive' } },
          { nameEn: { contains: 'phajay', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    const companyIds = targetCompanies.map((c) => c.id);

    const txns = await prisma.transaction.findMany({
      where: {
        transactionDate: { gte: from, lte: to },
        status: { in: ['POSTED', 'APPROVED'] },
        OR: [
          { companyId: { in: companyIds } },
          { category: { name: { contains: 'ຊັບສິນ' } } },
          { category: { name: { contains: 'ໜີ້ສິນ' } } },
          { note: { contains: 'ໜີ້ສິນ' } },
          { note: { contains: 'ຊັບສິນ' } },
        ],
        ...(query.companyId ? { companyId: query.companyId } : {}),
      },
      include: { company: true, bankAccount: { include: { bank: true } }, category: true },
      orderBy: { transactionDate: 'asc' },
    });

    const lakSide = txns.filter((t) => t.currency === 'LAK');
    const usdSide = txns.filter((t) => t.currency === 'USD');

    let lakBal = 0;
    const lakRows = lakSide.map((t, i) => {
      lakBal += Number(t.amount);
      return {
        seq: i + 1, id: t.id, date: t.transactionDate,
        amount: Number(t.amount), sent: null, balance: Math.round(lakBal * 100) / 100,
        description: t.description,
      };
    });

    let usdBal = 0;
    const usdRows = usdSide.map((t, i) => {
      usdBal += Number(t.amount);
      return {
        seq: i + 1, id: t.id, date: t.transactionDate,
        amount: Number(t.amount), sent: null, balance: Math.round(usdBal * 100) / 100,
        description: t.description,
      };
    });

    res.json({
      success: true,
      data: {
        lakSide: lakRows,
        usdSide: usdRows,
        lakTotal: Math.round(lakBal * 100) / 100,
        usdTotal: Math.round(usdBal * 100) / 100,
      },
    });
  }),
);

export default router;
