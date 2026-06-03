import * as XLSX from 'xlsx-js-style';
import { Prisma, TransactionType } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface ExportFilters {
  dateFrom: Date;
  dateTo: Date;
  companyId?: string;
  type?: 'daily' | 'daily-report' | 'stuck';
  companyIds?: string[];
  itemIds?: string[];
}

type Row = (string | number | null)[];
type Merge = { s: { r: number; c: number }; e: { r: number; c: number } };
// xlsx@0.18.x does not export CellStyle from its type defs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CellStyle = Record<string, any>;

interface TxnWithRels {
  id: string;
  transactionDate: Date;
  description: string;
  amount: Prisma.Decimal;
  currency: string;
  type: TransactionType;
  exchangeRate: Prisma.Decimal;
  amountInBase: Prisma.Decimal;
  bankReference: string | null;
  note: string | null;
  bankAccount: {
    id: string;
    accountNumber: string;
    accountName: string;
    accountType: string;
    currency: string;
    openingBalance: Prisma.Decimal;
    bank: { code: string; name: string };
  };
  company: { id: string; code: string; name: string };
  category: { id: string; code: string; name: string } | null;
  subCategory: { id: string; code: string; name: string } | null;
}

// ============================================================
// Styling helpers — thin border on every data cell
// ============================================================

// Match the frontend font (Noto Sans Lao) so exported workbooks render
// Lao text consistently in Excel/LibreOffice when the font is installed.
const FONT_NAME = 'Noto Sans Lao';
const BASE_FONT = { name: FONT_NAME };

const THIN: CellStyle = {
  font: { ...BASE_FONT },
  border: {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  },
};

const HEADER_STYLE: CellStyle = {
  fill: { fgColor: { rgb: 'D9E1F2' }, patternType: 'solid' },
  font: { ...BASE_FONT, bold: true },
  alignment: { horizontal: 'center', wrapText: true },
  border: {
    top: { style: 'medium', color: { rgb: '4472C4' } },
    bottom: { style: 'medium', color: { rgb: '4472C4' } },
    left: { style: 'thin', color: { rgb: '4472C4' } },
    right: { style: 'thin', color: { rgb: '4472C4' } },
  },
};

const TOTAL_STYLE: CellStyle = {
  fill: { fgColor: { rgb: 'FFF2CC' }, patternType: 'solid' },
  font: { ...BASE_FONT, bold: true },
  border: {
    top: { style: 'medium', color: { rgb: 'F4B942' } },
    bottom: { style: 'medium', color: { rgb: 'F4B942' } },
    left: { style: 'thin', color: { rgb: 'AAAAAA' } },
    right: { style: 'thin', color: { rgb: 'AAAAAA' } },
  },
};

// Apply Noto Sans Lao to every populated cell that doesn't already have a font set.
// Run after all per-range styles, so it fills in unstyled body cells without
// overriding HEADER/TOTAL bold variants.
function applyDefaultFont(ws: XLSX.WorkSheet) {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell || cell.t === 'z') continue;
      if (!cell.s) cell.s = {};
      if (!cell.s.font) {
        cell.s.font = { ...BASE_FONT };
      } else if (!cell.s.font.name) {
        cell.s.font.name = FONT_NAME;
      }
    }
  }
}


// Apply a style object to every populated cell in the range [r1,r2] x [c1,c2]
function styleRange(
  ws: XLSX.WorkSheet,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  style: CellStyle,
) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr] || ws[addr].t === 'z' || ws[addr].v === null || ws[addr].v === undefined) {
        ws[addr] = { t: 's', v: '', s: ws[addr]?.s };
      }
      ws[addr].s = style;
    }
  }
}

// Apply style only to populated (non-null) cells in range
function styleCells(
  ws: XLSX.WorkSheet,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  style: CellStyle,
) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws[addr] && ws[addr].v !== undefined && ws[addr].v !== null && ws[addr].t !== 'z') {
        ws[addr].s = { ...THIN, ...style };
      } else {
        // Still put a border on empty cells that are "inside" the table
        if (!ws[addr] || ws[addr].t === 'z' || ws[addr].v === null || ws[addr].v === undefined) {
          ws[addr] = { t: 's', v: '', s: ws[addr]?.s };
        }
        ws[addr].s = THIN;
      }
    }
  }
}

// Walk every cell that XLSX produced and add thin border
function borderAllCells(ws: XLSX.WorkSheet, dataRowStart: number) {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let r = dataRowStart; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      
      // Ensure empty cells are written as empty strings so borders are reliably rendered
      if (!ws[addr] || ws[addr].t === 'z' || ws[addr].v === null || ws[addr].v === undefined) {
        ws[addr] = { t: 's', v: '', s: ws[addr] ? ws[addr].s : undefined };
      }
      
      const blackBorder = {
        top: { style: 'thin', color: { rgb: '000000' } },
        bottom: { style: 'thin', color: { rgb: '000000' } },
        left: { style: 'thin', color: { rgb: '000000' } },
        right: { style: 'thin', color: { rgb: '000000' } },
      };

      if (!ws[addr].s) {
        ws[addr].s = { border: blackBorder };
      } else {
        ws[addr].s.border = { ...blackBorder, ...(ws[addr].s.border || {}) };
      }
    }
  }
}

// Safe Excel sheet name — strip invalid chars, cap at 31
function safeSheetName(s: string): string {
  return s.replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
}

// Format all number cells as comma-separated with 2 decimals
function formatAllNumbers(ws: XLSX.WorkSheet) {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  
  // Find columns that are "ລ/ດ"
  const skipCols = new Set<number>();
  for (let c = range.s.c; c <= range.e.c; c++) {
    for (let r = 0; r <= Math.min(range.e.r, 5); r++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws[addr] && typeof ws[addr].v === 'string' && ws[addr].v === 'ລ/ດ') {
        skipCols.add(c);
        break;
      }
    }
  }

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (skipCols.has(c)) continue;
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws[addr] && ws[addr].t === 'n') {
        ws[addr].z = '#,##0.00';
      }
    }
  }
}

// ============================================================
// Utilities
// ============================================================

const num = (d: Prisma.Decimal | number | null | undefined): number => {
  if (d === null || d === undefined) return 0;
  return typeof d === 'number' ? d : Number(d);
};

const fmtDate = (d: Date): string => {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};

const dayKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

// ============================================================
// Data fetching
// ============================================================

async function loadData(filters: ExportFilters) {
  const { dateFrom, dateTo, companyId, companyIds } = filters;

  const txnCoFilter: Prisma.TransactionWhereInput =
    companyId ? { companyId } :
    companyIds?.length ? { companyId: { in: companyIds } } : {};

  const acctCoFilter =
    companyId ? { companyId } :
    companyIds?.length ? { companyId: { in: companyIds } } : {};

  const coIdFilter =
    companyId ? { id: companyId } :
    companyIds?.length ? { id: { in: companyIds } } : {};

  const where: Prisma.TransactionWhereInput = {
    transactionDate: { gte: dateFrom, lte: dateTo },
    status: { in: ['POSTED', 'APPROVED'] },
    ...txnCoFilter,
  };

  const [txns, accounts, companies, latestRates] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: {
        company: true,
        bankAccount: { include: { bank: true } },
        category: true,
        subCategory: true,
      },
      orderBy: { transactionDate: 'asc' },
    }),
    prisma.bankAccount.findMany({
      where: { isActive: true, ...acctCoFilter },
      include: { bank: true, company: true },
      orderBy: [{ company: { code: 'asc' } }, { bank: { code: 'asc' } }],
    }),
    prisma.company.findMany({
      where: { isActive: true, ...coIdFilter },
      orderBy: { code: 'asc' },
    }),
    prisma.exchangeRate.findMany({
      where: { toCurrency: 'LAK', effectiveAt: { lte: dateTo } },
      orderBy: { effectiveAt: 'desc' },
    }),
  ]);

  const rates: Record<string, number> = { LAK: 1 };
  for (const r of latestRates) {
    if (!rates[r.fromCurrency]) rates[r.fromCurrency] = Number(r.rate);
  }
  if (!rates.THB) rates.THB = 660;
  if (!rates.USD) rates.USD = 21500;

  return { txns: txns as unknown as TxnWithRels[], accounts, companies, rates };
}

// ============================================================
// Sheet 1 — ສະຫຼຸບປະຈໍາວັນ
// ============================================================

function buildSheet1Daily(
  txns: TxnWithRels[],
  allTxnsFromStart: { id: string; transactionDate: Date; type: TransactionType; amount: Prisma.Decimal; bankAccountId: string }[],
  accounts: { id: string; currency: string; accountType: string; currentBalance: Prisma.Decimal }[],
  rates: Record<string, number>,
  filters: ExportFilters,
): { ws: XLSX.WorkSheet; name: string } {
  // Cap the end date to today so future dates are never shown
  const capDate = new Date(Math.min(filters.dateTo.getTime(), Date.now()));
  capDate.setHours(23, 59, 59, 999);

  // Build every day in [dateFrom, capDate] — carry-forward even if no transactions
  const allDays: string[] = [];
  const cursor = new Date(filters.dateFrom);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= capDate) {
    allDays.push(dayKey(new Date(cursor)));
    cursor.setDate(cursor.getDate() + 1);
  }

  // Compute opening balances: start from currentBalance, then subtract
  // every transaction that happened on or after dateFrom (rewind to opening).
  const accountOpening = new Map<string, number>();
  for (const a of accounts) {
    accountOpening.set(a.id, Number(a.currentBalance));
  }
  for (const t of allTxnsFromStart) {
    const signed = t.type === TransactionType.INCOME ? Number(t.amount) : -Number(t.amount);
    accountOpening.set(t.bankAccountId, (accountOpening.get(t.bankAccountId) ?? 0) - signed);
  }
  // Running balances walk forward day by day from the opening value.
  const runningBalances = new Map<string, number>(accountOpening);

  // Group in-range txns by day for fast lookup
  const txnsByDay = new Map<string, TxnWithRels[]>();
  for (const t of txns) {
    const k = dayKey(t.transactionDate);
    if (!txnsByDay.has(k)) txnsByDay.set(k, []);
    txnsByDay.get(k)!.push(t);
  }

  const rows: Row[] = [];

  // R0: rate banner
  rows.push(['ອັດຕາແລກປ່ຽນ', null, null, null, null, 'LAK', '1', 'THB', String(rates.THB), 'USD', String(rates.USD)]);
  rows.push([]); // R1 blank

  // R2: header group
  rows.push([
    'ລ/ດ', 'ວ/ດ/ປ',
    'ລວມຍອດເງິນທັງໝົດ\n(ທຽບເທົ່າກີບ)',
    'ເງິນທີ່ສາມາດ\nໃຊ້ໄດ້ແທ້',
    'ລວມຍອດເງິນ\nທີ່ຫັກໃວ້',
    'ຍອດເຫຼືອບັນຊີທັງໝົດ', null, null,
    'ລວມຍອດຮັບທັງໝົດ', null, null,
    'ລວມຍອດຈ່າຍທັງໝົດ', null, null,
    'ອັດຕາແລກປ່ຽນ\nປະຈໍາວັນ', null, null,
    'ເຊັກຈຳນວນລວມ\nເງິນທຽບເງິນຜ່ານມາ',
    'ເຊັກລວມ\nລາຍຮັບ-ລາຍຈ່າຍ',
    'ສ່ວນຕ່າງ\nອັດຕາແລກປ່ຽນ',
  ]);
  // R3: currency sub-headers
  rows.push([
    null, null, null, null, null,
    'LAK', 'THB', 'USD',
    'LAK', 'THB', 'USD',
    'LAK', 'THB', 'USD',
    'LAK', 'THB', 'USD',
    null, null, null,
  ]);

  let prevTotalLAK = 0;

  allDays.forEach((day, idx) => {
    const list = txnsByDay.get(day) ?? [];

    const inc: Record<string, number> = { LAK: 0, THB: 0, USD: 0 };
    const exp: Record<string, number> = { LAK: 0, THB: 0, USD: 0 };

    // Apply today's movements to running balances + collect income/expense
    for (const t of list) {
      const signed = t.type === 'INCOME' ? num(t.amount) : -num(t.amount);
      runningBalances.set(t.bankAccount.id, (runningBalances.get(t.bankAccount.id) ?? 0) + signed);
      if (t.currency in inc) {
        if (t.type === 'INCOME') inc[t.currency] += num(t.amount);
        else if (t.type === 'EXPENSE') exp[t.currency] += num(t.amount);
      }
    }

    // Aggregate running balances per currency + split usable/stuck
    const bal: Record<string, number> = { LAK: 0, THB: 0, USD: 0 };
    let usableLAK = 0;
    let stuckLAK = 0;
    for (const a of accounts) {
      const b = runningBalances.get(a.id) ?? 0;
      const cur = a.currency as string;
      if (cur in bal) bal[cur] += b;
      const rate = rates[cur] || 1;
      if (a.accountType !== 'FIXED_DEPOSIT') usableLAK += b * rate;
      else stuckLAK += b * rate;
    }
    const totalLAK = usableLAK + stuckLAK;

    const incLAK = inc.LAK * (rates.LAK || 1) + inc.THB * (rates.THB || 1) + inc.USD * (rates.USD || 1);
    const expLAK = exp.LAK * (rates.LAK || 1) + exp.THB * (rates.THB || 1) + exp.USD * (rates.USD || 1);
    const checkPrev = idx === 0 ? 0 : r2(totalLAK - prevTotalLAK - (incLAK - expLAK));
    const checkIE = r2(incLAK - expLAK);
    prevTotalLAK = totalLAK;

    rows.push([
      idx + 1, fmtDate(new Date(day)),
      r2(totalLAK), r2(usableLAK), r2(stuckLAK),
      bal.LAK || null, bal.THB || null, bal.USD || null,
      inc.LAK || null, inc.THB || null, inc.USD || null,
      exp.LAK || null, exp.THB || null, exp.USD || null,
      rates.LAK, rates.THB, rates.USD,
      checkPrev, checkIE, 0,
    ]);

    // Per-company sub-rows for the day (LAK-equivalent).
    type DayCompanyAgg = { code: string; name: string; incLAK: number; expLAK: number; cnt: number };
    const dayCoMap = new Map<string, DayCompanyAgg>();
    for (const t of list) {
      if (!(t.currency in { LAK: 1, THB: 1, USD: 1 })) continue;
      const key = t.company?.id ?? '__none__';
      if (!dayCoMap.has(key)) {
        dayCoMap.set(key, {
          code: t.company?.code ?? '-',
          name: t.company?.name ?? 'ບໍ່ໄດ້ກຳນົດບໍລິສັດ',
          incLAK: 0,
          expLAK: 0,
          cnt: 0,
        });
      }
      const entry = dayCoMap.get(key)!;
      const amt = num(t.amount);
      const rate = rates[t.currency] ?? 1;
      entry.cnt += 1;
      if (t.type === 'INCOME') entry.incLAK += amt * rate;
      else if (t.type === 'EXPENSE') entry.expLAK += amt * rate;
    }
    const dayCoArr = Array.from(dayCoMap.values()).sort((a, b) => b.expLAK - a.expLAK);
    for (const co of dayCoArr) {
      const netLAK = co.incLAK - co.expLAK;
      rows.push([
        null,
        `   └ ${co.code} — ${co.name}`,
        r2(netLAK) || null, null, null,
        null, null, null,
        r2(co.incLAK) || null, null, null,
        r2(co.expLAK) || null, null, null,
        null, null, null,
        null, null, null,
      ]);
    }
  });

  if (allDays.length === 0) {
    rows.push([1, fmtDate(filters.dateFrom), 0, 0, 0, null, null, null, null, null, null, null, null, null, rates.LAK, rates.THB, rates.USD, 0, 0, 0]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Merges: header groups (row index 2)
  const merges: Merge[] = [
    { s: { r: 2, c: 5 }, e: { r: 2, c: 7 } },
    { s: { r: 2, c: 8 }, e: { r: 2, c: 10 } },
    { s: { r: 2, c: 11 }, e: { r: 2, c: 13 } },
    { s: { r: 2, c: 14 }, e: { r: 2, c: 16 } },
    // Single-col headers span 2 rows (rows 2+3)
    { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } },
    { s: { r: 2, c: 1 }, e: { r: 3, c: 1 } },
    { s: { r: 2, c: 2 }, e: { r: 3, c: 2 } },
    { s: { r: 2, c: 3 }, e: { r: 3, c: 3 } },
    { s: { r: 2, c: 4 }, e: { r: 3, c: 4 } },
    { s: { r: 2, c: 17 }, e: { r: 3, c: 17 } },
    { s: { r: 2, c: 18 }, e: { r: 3, c: 18 } },
    { s: { r: 2, c: 19 }, e: { r: 3, c: 19 } },
  ];
  ws['!merges'] = merges;

  // Style header rows
  const totalCols = 20;
  styleRange(ws, 2, 0, 3, totalCols - 1, HEADER_STYLE);
  // Style data rows (data starts on row index 4; rows.length is the row count, last data row is rows.length - 1)
  const dataStart = 4;
  borderAllCells(ws, dataStart);

  ws['!cols'] = [
    { wch: 5 }, { wch: 13 }, { wch: 20 }, { wch: 18 }, { wch: 16 },
    { wch: 14 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 10 }, { wch: 10 },
    { wch: 20 }, { wch: 20 }, { wch: 18 },
  ];

  return { ws, name: 'ສະຫຼຸບປະຈໍາວັນ' };
}

// ============================================================
// Sheet 2 — LLL ສະຫຼຸບ ລາຍຮັບ-ລາຍຈ່າຍ-ຍອດຍັງ (Master Ledger)
// ============================================================

interface AccountColumn {
  bankAccountId: string;
  bankCode: string;
  holderName: string;
  currency: string;
}

function buildAccountColumns(
  accounts: { id: string; accountName: string; currency: string; bank: { code: string } }[],
): AccountColumn[] {
  const cols = accounts.map((a) => ({
    bankAccountId: a.id,
    bankCode: a.bank.code,
    holderName: a.accountName,
    currency: a.currency,
  }));
  cols.sort(
    (a, b) =>
      a.bankCode.localeCompare(b.bankCode) ||
      a.currency.localeCompare(b.currency) ||
      a.holderName.localeCompare(b.holderName),
  );
  return cols;
}

function buildSheet2Master(
  txns: TxnWithRels[],
  accounts: AccountColumn[],
  rates: Record<string, number>,
  _companies?: { id: string; code: string; name: string }[],
): { ws: XLSX.WorkSheet; name: string } {
  const N = accounts.length || 1;
  const rows: Row[] = [];

  // R0: rate banner
  rows.push(['ອັດຕາແລກປ່ຽນ', 'LAK', rates.LAK, 'THB', rates.THB, 'USD', rates.USD]);
  rows.push([]);

  // R2: super-group header
  const hdr1: Row = ['ລ/ດ', 'ວ/ດ/ປ', 'ເນື້ອໃນລາຍການ', 'ບໍລິສັດ'];
  for (let i = 0; i < N; i++) hdr1.push(i === 0 ? 'ຮັບ (Income)' : null);
  for (let i = 0; i < N; i++) hdr1.push(i === 0 ? 'ຈ່າຍ (Expense)' : null);
  for (let i = 0; i < N; i++) hdr1.push(i === 0 ? 'ຍອດເຫຼືອ (Balance)' : null);
  rows.push(hdr1);

  // R3: bank code
  const hdr2: Row = [null, null, null, null];
  for (let b = 0; b < 3; b++) accounts.forEach((a) => hdr2.push(a.bankCode));
  rows.push(hdr2);

  // R4: holder name
  const hdr3: Row = [null, null, null, null];
  for (let b = 0; b < 3; b++) accounts.forEach((a) => hdr3.push(a.holderName));
  rows.push(hdr3);

  // R5: currency
  const hdr4: Row = [null, null, null, null];
  for (let b = 0; b < 3; b++) accounts.forEach((a) => hdr4.push(a.currency));
  rows.push(hdr4);

  // Data rows
  const acctIdx = new Map<string, number>();
  accounts.forEach((a, i) => acctIdx.set(a.bankAccountId, i));
  const balance: number[] = new Array(N).fill(0);

  let rowNum = 1;
  for (const t of txns) {
    const i = acctIdx.get(t.bankAccount.id);
    if (i === undefined) continue;
    const amt = num(t.amount);
    if (t.type === 'INCOME') balance[i] += amt;
    else if (t.type === 'EXPENSE') balance[i] -= amt;

    const row: Row = [rowNum++, fmtDate(t.transactionDate), t.description, t.company.name];
    for (let k = 0; k < N; k++) row.push(t.type === 'INCOME' && k === i ? amt : null);
    for (let k = 0; k < N; k++) row.push(t.type === 'EXPENSE' && k === i ? amt : null);
    for (let k = 0; k < N; k++) row.push(k === i ? r2(balance[k]) : null);
    rows.push(row);
  }

  // Total row
  const totalRow: Row = ['ລວມທັງໝົດ', null, null, null];
  for (let i = 0; i < N; i++) {
    totalRow.push(r2(txns.filter((t) => t.type === 'INCOME' && acctIdx.get(t.bankAccount.id) === i).reduce((s, t) => s + num(t.amount), 0)) || null);
  }
  for (let i = 0; i < N; i++) {
    totalRow.push(r2(txns.filter((t) => t.type === 'EXPENSE' && acctIdx.get(t.bankAccount.id) === i).reduce((s, t) => s + num(t.amount), 0)) || null);
  }
  for (let i = 0; i < N; i++) totalRow.push(r2(balance[i]) || null);
  rows.push(totalRow);

  // ── Per-company summary block (appended below the master ledger) ──
  const lastRowMaster = rows.length - 1;
  rows.push([]);
  rows.push(['ສະຫຼຸບແຍກຕາມບໍລິສັດ (ທຽບເທົ່າກີບ)']);
  const coHdrRow = rows.length;
  rows.push(['ບໍລິສັດ', 'ລາຍຮັບ (LAK)', 'ລາຍຈ່າຍ (LAK)', 'ກະແສເງິນສຸດທິ (LAK)', 'ລາຍການ']);

  type CompanyAgg = {
    code: string;
    name: string;
    incLAK: number;
    expLAK: number;
    cnt: number;
  };
  const coMap = new Map<string, CompanyAgg>();
  for (const t of txns) {
    if (!acctIdx.has(t.bankAccount.id)) continue;
    const key = t.company?.id ?? '__none__';
    if (!coMap.has(key)) {
      coMap.set(key, {
        code: t.company?.code ?? '-',
        name: t.company?.name ?? 'ບໍ່ໄດ້ກຳນົດບໍລິສັດ',
        incLAK: 0,
        expLAK: 0,
        cnt: 0,
      });
    }
    const entry = coMap.get(key)!;
    const amt = num(t.amount);
    const rate = rates[t.currency] ?? 1;
    entry.cnt += 1;
    if (t.type === 'INCOME') entry.incLAK += amt * rate;
    else if (t.type === 'EXPENSE') entry.expLAK += amt * rate;
  }
  const coArr = Array.from(coMap.values()).sort((a, b) => b.expLAK - a.expLAK);
  for (const co of coArr) {
    rows.push([
      `${co.code} — ${co.name}`,
      r2(co.incLAK) || null,
      r2(co.expLAK) || null,
      r2(co.incLAK - co.expLAK) || null,
      co.cnt,
    ]);
  }
  const coTotalRowIdx = rows.length;
  rows.push([
    'ລວມທັງໝົດ',
    r2(coArr.reduce((s, c) => s + c.incLAK, 0)) || null,
    r2(coArr.reduce((s, c) => s + c.expLAK, 0)) || null,
    r2(coArr.reduce((s, c) => s + c.incLAK - c.expLAK, 0)) || null,
    coArr.reduce((s, c) => s + c.cnt, 0),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Merges for super-group headers (row 2)
  const base = 4;
  const merges: Merge[] = [];
  if (N > 1) {
    merges.push({ s: { r: 2, c: base }, e: { r: 2, c: base + N - 1 } });
    merges.push({ s: { r: 2, c: base + N }, e: { r: 2, c: base + 2 * N - 1 } });
    merges.push({ s: { r: 2, c: base + 2 * N }, e: { r: 2, c: base + 3 * N - 1 } });
  }
  ws['!merges'] = merges;

  // Style headers (rows 2–5)
  styleRange(ws, 2, 0, 5, 3 + N * 3, HEADER_STYLE);
  // Style data rows with alternating borders
  borderAllCells(ws, 6);
  // Master ledger total row
  styleRange(ws, lastRowMaster, 0, lastRowMaster, 3 + N * 3, TOTAL_STYLE);
  // Company summary header + total row
  styleRange(ws, coHdrRow, 0, coHdrRow, 4, HEADER_STYLE);
  styleRange(ws, coTotalRowIdx, 0, coTotalRowIdx, 4, TOTAL_STYLE);

  ws['!cols'] = [
    { wch: 5 }, { wch: 13 }, { wch: 36 }, { wch: 20 },
    ...new Array(N * 3).fill({ wch: 14 }),
  ];

  return { ws, name: 'LLL ສະຫຼຸບ ລາຍຮັບ-ລາຍຈ່າຍ' };
}

// ============================================================
// Sheet 3 — ລາຍງານການເງີນປະຈຳວັນ
// Summary per COMPANY from the DB for dateTo day.
// Layout: one block per company showing income / expense / PNL / balance
//         with per-currency breakdown (LAK / THB / USD).
// ============================================================

function buildSheet3DailyReport(
  txns: TxnWithRels[],
  companies: { id: string; code: string; name: string }[],
  rates: Record<string, number>,
  filters: ExportFilters,
): { ws: XLSX.WorkSheet; name: string } {
  // Use all transactions in the date range (not just the last day)
  const CUR = ['LAK', 'THB', 'USD'] as const;
  const dateLabel = `${fmtDate(filters.dateFrom)} - ${fmtDate(filters.dateTo)}`;

  const rows: Row[] = [];

  // ── Title block ──────────────────────────────────────────
  rows.push(['ລາຍງານການເງີນປະຈຳວັນ', null, null, null, null, null, null, dateLabel]);
  rows.push([]);

  // ── Exchange rate block ───────────────────────────────────
  rows.push(['ອັດຕາແລກປ່ຽນ', 'ສະກຸນ', 'ເທົ່າກັບກີບ']);
  rows.push([null, 'LAK', 1]);
  rows.push([null, 'THB', rates.THB]);
  rows.push([null, 'USD', rates.USD]);
  rows.push([]);

  // ── Grand total (all companies, entire range) ─────────────
  const allInc: Record<string, number> = { LAK: 0, THB: 0, USD: 0 };
  const allExp: Record<string, number> = { LAK: 0, THB: 0, USD: 0 };
  for (const t of txns) {
    if (!(t.currency in allInc)) continue;
    if (t.type === 'INCOME') allInc[t.currency] += num(t.amount);
    else if (t.type === 'EXPENSE') allExp[t.currency] += num(t.amount);
  }
  const grandIncLAK = allInc.LAK * rates.LAK + allInc.THB * rates.THB + allInc.USD * rates.USD;
  const grandExpLAK = allExp.LAK * rates.LAK + allExp.THB * rates.THB + allExp.USD * rates.USD;

  rows.push(['ສະຫຼຸບລວມທັງໝົດ (ທຸກບໍລິສັດ)', null, null, null, null, null, null, null, 'ທຽບເທົ່າກີບ']);
  rows.push(['ລາຍຮັບທັງໝົດ', null, null, null, null, null, null, null, r2(grandIncLAK)]);
  rows.push(['ລາຍຈ່າຍທັງໝົດ', null, null, null, null, null, null, null, r2(grandExpLAK)]);
  rows.push(['PNL ລວມ', null, null, null, null, null, null, null, r2(grandIncLAK - grandExpLAK)]);
  rows.push([]);

  // ── Per-company header row ────────────────────────────────
  const colsHeader: Row = [
    'ບໍລິສັດ',
    'ລາຍການ',
    'LAK (ຮັບ)', 'THB (ຮັບ)', 'USD (ຮັບ)',
    'LAK (ຈ່າຍ)', 'THB (ຈ່າຍ)', 'USD (ຈ່າຍ)',
    'PNL ທຽບເທົ່າກີບ',
  ];
  rows.push(colsHeader);
  const hdrRowIdx = rows.length - 1;

  // ── One block per company ─────────────────────────────────
  companies.forEach((co) => {
    const coTxns = txns.filter((t) => t.company.id === co.id);
    const inc: Record<string, number> = { LAK: 0, THB: 0, USD: 0 };
    const exp: Record<string, number> = { LAK: 0, THB: 0, USD: 0 };
    for (const t of coTxns) {
      if (!(t.currency in inc)) continue;
      if (t.type === 'INCOME') inc[t.currency] += num(t.amount);
      else if (t.type === 'EXPENSE') exp[t.currency] += num(t.amount);
    }
    const incLAK = inc.LAK * rates.LAK + inc.THB * rates.THB + inc.USD * rates.USD;
    const expLAK = exp.LAK * rates.LAK + exp.THB * rates.THB + exp.USD * rates.USD;
    const pnl = r2(incLAK - expLAK);

    rows.push([
      `${co.code} — ${co.name}`,
      'ລາຍຮັບ',
      inc.LAK || null, inc.THB || null, inc.USD || null,
      null, null, null,
      r2(incLAK),
    ]);
    rows.push([
      null,
      'ລາຍຈ່າຍ',
      null, null, null,
      exp.LAK || null, exp.THB || null, exp.USD || null,
      r2(expLAK),
    ]);
    rows.push([
      null,
      'PNL',
      null, null, null, null, null, null,
      pnl,
    ]);

    // Per account breakdown under this company
    const accts = new Map<string, { bankCode: string; name: string; inc: Record<string, number>; exp: Record<string, number> }>();
    for (const t of coTxns) {
      const k = t.bankAccount.id;
      if (!accts.has(k)) {
        accts.set(k, {
          bankCode: t.bankAccount.bank.code,
          name: t.bankAccount.accountName,
          inc: { LAK: 0, THB: 0, USD: 0 },
          exp: { LAK: 0, THB: 0, USD: 0 },
        });
      }
      const entry = accts.get(k)!;
      if (!(t.currency in entry.inc)) continue;
      if (t.type === 'INCOME') entry.inc[t.currency] += num(t.amount);
      else if (t.type === 'EXPENSE') entry.exp[t.currency] += num(t.amount);
    }

    for (const [, a] of accts) {
      const aIncLAK = a.inc.LAK * rates.LAK + a.inc.THB * rates.THB + a.inc.USD * rates.USD;
      const aExpLAK = a.exp.LAK * rates.LAK + a.exp.THB * rates.THB + a.exp.USD * rates.USD;
      rows.push([
        null,
        `  ${a.bankCode} • ${a.name}`,
        a.inc.LAK || null, a.inc.THB || null, a.inc.USD || null,
        a.exp.LAK || null, a.exp.THB || null, a.exp.USD || null,
        r2(aIncLAK - aExpLAK),
      ]);
    }

    rows.push([]); // blank line between companies
  });

  // No data guard
  if (companies.length === 0 || txns.length === 0) {
    rows.push(['(ບໍ່ມີຂໍ້ມູນ)']);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Style header row
  styleRange(ws, hdrRowIdx, 0, hdrRowIdx, 8, HEADER_STYLE);
  // Grand total rows (rows 8–11 = indices 7–10)
  styleRange(ws, 7, 0, 10, 8, TOTAL_STYLE);
  // All data cells
  borderAllCells(ws, 12);

  ws['!cols'] = [
    { wch: 28 }, { wch: 22 },
    { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 20 },
  ];

  return { ws, name: 'ລາຍງານການເງີນປະຈຳວັນ' };
}

// ============================================================
// Per-company master sheet (for daily-report multi-company export)
// ============================================================

function buildPerCompanyMasterSheet(
  txns: TxnWithRels[],
  allAccounts: { id: string; accountName: string; accountType: string; currency: string; openingBalance: Prisma.Decimal; currentBalance: Prisma.Decimal; bank: { code: string; name: string }; company: { id: string; code: string; name: string } }[],
  rates: Record<string, number>,
  company: { id: string; code: string; name: string },
): { ws: XLSX.WorkSheet; name: string } {
  const coTxns = txns.filter((t) => t.company.id === company.id);
  const coAccounts = allAccounts.filter((a) => a.company.id === company.id);
  const acctCols = buildAccountColumns(coAccounts);
  const { ws } = buildSheet2Master(coTxns, acctCols, rates, [company]);
  // User-requested name: "<company> ສະຫຼຸບ ລາຍຮັບ-ລາຍຈ່າຍ".
  // Excel caps sheet names at 31 chars — keep the company name visible and let
  // the suffix truncate; makeUniqueNamer() guarantees uniqueness on collision.
  const name = `${company.name} ສະຫຼຸບ ລາຍຮັບ-ລາຍຈ່າຍ`;
  return { ws, name };
}

// ============================================================
// NFI-item sheets (for stuck multi-item export)
// ============================================================

type NfiItemWithRelations = {
  id: string;
  type: string;
  description: string;
  amount: Prisma.Decimal;
  currency: string | null;
  date: Date;
  bankAccount: {
    id: string;
    accountName: string;
    accountNumber: string;
    currency: string;
    company: { id: string; code: string; name: string };
    bank: { id: string; code: string; name: string };
  };
};

async function loadNfiItems(itemIds?: string[]): Promise<NfiItemWithRelations[]> {
  return prisma.nonFinancialItem.findMany({
    where: itemIds && itemIds.length > 0 ? { id: { in: itemIds } } : undefined,
    include: {
      bankAccount: {
        include: {
          company: { select: { id: true, code: true, name: true } },
          bank: { select: { id: true, code: true, name: true } },
        },
      },
    },
    orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
  }) as Promise<NfiItemWithRelations[]>;
}

async function loadRates(dateTo: Date): Promise<Record<string, number>> {
  const latestRates = await prisma.exchangeRate.findMany({
    where: { toCurrency: 'LAK', effectiveAt: { lte: dateTo } },
    orderBy: { effectiveAt: 'desc' },
  });
  const rates: Record<string, number> = { LAK: 1 };
  for (const rate of latestRates) {
    if (!rates[rate.fromCurrency]) rates[rate.fromCurrency] = Number(rate.rate);
  }
  if (!rates.THB) rates.THB = 660;
  if (!rates.USD) rates.USD = 21500;
  return rates;
}

function buildNfiItemsCombinedSheet(
  items: NfiItemWithRelations[],
  rates: Record<string, number>,
): { ws: XLSX.WorkSheet; name: string } {
  const rows: Row[] = [];
  rows.push(['ລາຍການເງິນທີ່ໃຊ້ບໍ່ໄດ້', null, null, null, null, null, null, null, null]);
  rows.push([]);
  rows.push(['ລ/ດ', 'ລາຍລະອຽດ', 'ປະເພດ', 'ບໍລິສັດ', 'ທະນາຄານ', 'ເລກບັນຊີ', 'ສະກຸນ', 'ຈຳນວນ', 'ທຽບເທົ່າກີບ']);
  const hdrRow = 2;
  let total = 0;
  items.forEach((item, i) => {
    const currency = item.currency ?? item.bankAccount.currency;
    const amt = Number(item.amount);
    const lak = r2(amt * (rates[currency] ?? 1));
    total += lak;
    rows.push([i + 1, item.description, item.type, item.bankAccount.company.name, item.bankAccount.bank.code, item.bankAccount.accountNumber, currency, amt || null, lak]);
  });
  if (items.length === 0) rows.push([1, '(ບໍ່ມີຂໍ້ມູນ)', null, null, null, null, null, null, 0]);
  rows.push([]);
  rows.push(['ລວມ', null, null, null, null, null, null, null, r2(total)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  styleRange(ws, hdrRow, 0, hdrRow, 8, HEADER_STYLE);
  borderAllCells(ws, hdrRow + 1);
  styleRange(ws, rows.length - 1, 0, rows.length - 1, 8, TOTAL_STYLE);
  formatAllNumbers(ws);
  applyDefaultFont(ws);
  ws['!cols'] = [{ wch: 5 }, { wch: 36 }, { wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 20 }, { wch: 8 }, { wch: 14 }, { wch: 16 }];
  return { ws, name: 'ລາຍການເງິນທີ່ໃຊ້ບໍ່ໄດ້' };
}

function buildNfiItemDetailSheet(
  item: NfiItemWithRelations,
  rates: Record<string, number>,
): { ws: XLSX.WorkSheet; name: string } {
  const currency = item.currency ?? item.bankAccount.currency;
  const amt = Number(item.amount);
  const lak = r2(amt * (rates[currency] ?? 1));
  const rows: Row[] = [
    ['ລາຍລະອຽດ', 'ຂໍ້ມູນ'],
    ['ຄຳອະທິບາຍ', item.description],
    ['ປະເພດ', item.type],
    ['ວັນທີ', fmtDate(item.date)],
    ['ບໍລິສັດ', item.bankAccount.company.name],
    ['ທະນາຄານ', item.bankAccount.bank.code],
    ['ຊື່ບັນຊີ', item.bankAccount.accountName],
    ['ເລກບັນຊີ', item.bankAccount.accountNumber],
    ['ສະກຸນ', currency],
    ['ຈຳນວນ', amt],
    ['ທຽບເທົ່າກີບ', lak],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  styleRange(ws, 0, 0, 0, 1, HEADER_STYLE);
  borderAllCells(ws, 1);
  styleRange(ws, rows.length - 1, 0, rows.length - 1, 1, TOTAL_STYLE);
  formatAllNumbers(ws);
  applyDefaultFont(ws);
  ws['!cols'] = [{ wch: 20 }, { wch: 40 }];
  return { ws, name: safeSheetName(item.description) };
}

// ============================================================
// Public entry
// ============================================================

// Ensure every sheet name is unique and within Excel's 31-char limit.
function makeUniqueNamer() {
  const used = new Set<string>();
  return (raw: string): string => {
    const base = safeSheetName(raw);
    let name = base;
    let i = 2;
    while (used.has(name)) {
      const suffix = ` (${i})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
      i++;
    }
    used.add(name);
    return name;
  };
}

function appendSheet(
  wb: XLSX.WorkBook,
  s: { ws: XLSX.WorkSheet; name: string },
  namer: (raw: string) => string,
) {
  formatAllNumbers(s.ws);
  applyDefaultFont(s.ws);
  XLSX.utils.book_append_sheet(wb, s.ws, namer(s.name));
}

// type = 'daily' → only the daily-summary sheet (ສະຫຼຸບປະຈໍາວັນ)
async function buildDailyWorkbook(filters: ExportFilters): Promise<Buffer> {
  const { txns, accounts, rates } = await loadData(filters);

  // Fetch ALL transactions from dateFrom onwards (no upper bound) so we can
  // rewind currentBalance back to the opening balance at the start of the range.
  const allTxnsFromStart = await prisma.transaction.findMany({
    where: {
      status: { in: ['POSTED', 'APPROVED'] },
      bankAccountId: { in: accounts.map((a) => a.id) },
      transactionDate: { gte: filters.dateFrom },
    },
    select: {
      id: true,
      transactionDate: true,
      type: true,
      amount: true,
      bankAccountId: true,
    },
  });

  const wb = XLSX.utils.book_new();
  const namer = makeUniqueNamer();
  appendSheet(wb, buildSheet1Daily(txns, allTxnsFromStart, accounts, rates, filters), namer);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// type = 'daily-report' → combined report sheet + one master sheet per company
async function buildDailyReportWorkbook(filters: ExportFilters): Promise<Buffer> {
  const { txns, accounts, companies, rates } = await loadData(filters);
  const wb = XLSX.utils.book_new();
  const namer = makeUniqueNamer();
  appendSheet(wb, buildSheet3DailyReport(txns, companies, rates, filters), namer);
  for (const co of companies) {
    appendSheet(wb, buildPerCompanyMasterSheet(txns, accounts, rates, co), namer);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// type = 'stuck' → combined list sheet + one detail sheet per NFI item
async function buildStuckWorkbook(filters: ExportFilters): Promise<Buffer> {
  const [items, rates] = await Promise.all([
    loadNfiItems(filters.itemIds),
    loadRates(filters.dateTo),
  ]);
  const wb = XLSX.utils.book_new();
  const namer = makeUniqueNamer();
  appendSheet(wb, buildNfiItemsCombinedSheet(items, rates), namer);
  for (const item of items) {
    appendSheet(wb, buildNfiItemDetailSheet(item, rates), namer);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export const exportService = {
  async buildWorkbook(filters: ExportFilters): Promise<Buffer> {
    if (filters.type === 'daily-report') return buildDailyReportWorkbook(filters);
    if (filters.type === 'stuck') return buildStuckWorkbook(filters);
    // default + 'daily' → daily-summary only
    return buildDailyWorkbook(filters);
  },
};
