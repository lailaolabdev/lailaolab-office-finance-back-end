import * as XLSX from 'xlsx-js-style';
import { Prisma, TransactionType } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface ExportFilters {
  dateFrom: Date;
  dateTo: Date;
  companyId?: string;
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

const THIN: CellStyle = {
  border: {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  },
};

const HEADER_STYLE: CellStyle = {
  fill: { fgColor: { rgb: 'D9E1F2' }, patternType: 'solid' },
  font: { bold: true },
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
  font: { bold: true },
  border: {
    top: { style: 'medium', color: { rgb: 'F4B942' } },
    bottom: { style: 'medium', color: { rgb: 'F4B942' } },
    left: { style: 'thin', color: { rgb: 'AAAAAA' } },
    right: { style: 'thin', color: { rgb: 'AAAAAA' } },
  },
};


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
  const { dateFrom, dateTo, companyId } = filters;

  const where: Prisma.TransactionWhereInput = {
    transactionDate: { gte: dateFrom, lte: dateTo },
    status: { in: ['POSTED', 'APPROVED'] },
    ...(companyId ? { companyId } : {}),
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
      where: { isActive: true, ...(companyId ? { companyId } : {}) },
      include: { bank: true, company: true },
      orderBy: [{ company: { code: 'asc' } }, { bank: { code: 'asc' } }],
    }),
    prisma.company.findMany({
      where: { isActive: true, ...(companyId ? { id: companyId } : {}) },
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
  rates: Record<string, number>,
  filters: ExportFilters,
): { ws: XLSX.WorkSheet; name: string } {
  const byDay = new Map<string, TxnWithRels[]>();
  for (const t of txns) {
    const k = dayKey(t.transactionDate);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(t);
  }
  const days = Array.from(byDay.keys()).sort();

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

  let runningLAK = 0;
  days.forEach((day, idx) => {
    const list = byDay.get(day)!;
    const inc: Record<string, number> = { LAK: 0, THB: 0, USD: 0 };
    const exp: Record<string, number> = { LAK: 0, THB: 0, USD: 0 };
    for (const t of list) {
      if (t.currency in inc) {
        if (t.type === 'INCOME') inc[t.currency] += num(t.amount);
        else if (t.type === 'EXPENSE') exp[t.currency] += num(t.amount);
      }
    }
    const bal = { LAK: inc.LAK - exp.LAK, THB: inc.THB - exp.THB, USD: inc.USD - exp.USD };
    const totalLAK = bal.LAK * rates.LAK + bal.THB * rates.THB + bal.USD * rates.USD;
    const incLAK = inc.LAK * rates.LAK + inc.THB * rates.THB + inc.USD * rates.USD;
    const expLAK = exp.LAK * rates.LAK + exp.THB * rates.THB + exp.USD * rates.USD;
    const checkPrev = r2(totalLAK - runningLAK);
    const checkIE = r2(incLAK - expLAK);
    runningLAK = totalLAK;

    rows.push([
      idx + 1, fmtDate(new Date(day)),
      r2(totalLAK), r2(totalLAK), 0,
      bal.LAK || null, bal.THB || null, bal.USD || null,
      inc.LAK || null, inc.THB || null, inc.USD || null,
      exp.LAK || null, exp.THB || null, exp.USD || null,
      rates.LAK, rates.THB, rates.USD,
      checkPrev, checkIE, 0,
    ]);
  });

  if (days.length === 0) {
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
  // Style data rows
  const dataStart = 4;
  const dataEnd = 3 + Math.max(days.length, 1);
  borderAllCells(ws, dataStart);
  // Total row style
  if (days.length > 1) styleRange(ws, dataEnd, 0, dataEnd, totalCols - 1, TOTAL_STYLE);

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
  // Total row
  const lastRow = 6 + txns.filter((t) => acctIdx.has(t.bankAccount.id)).length;
  styleRange(ws, lastRow, 0, lastRow, 3 + N * 3, TOTAL_STYLE);

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
  const target = filters.dateTo;
  const dayTxns = txns.filter((t) => dayKey(t.transactionDate) === dayKey(target));
  const CUR = ['LAK', 'THB', 'USD'] as const;

  const rows: Row[] = [];

  // ── Title block ──────────────────────────────────────────
  rows.push(['ລາຍງານການເງີນປະຈຳວັນ', null, null, null, null, null, null, fmtDate(target)]);
  rows.push([]);

  // ── Exchange rate block ───────────────────────────────────
  rows.push(['ອັດຕາແລກປ່ຽນ', 'ສະກຸນ', 'ເທົ່າກັບກີບ']);
  rows.push([null, 'LAK', 1]);
  rows.push([null, 'THB', rates.THB]);
  rows.push([null, 'USD', rates.USD]);
  rows.push([]);

  // ── Grand total (all companies) ───────────────────────────
  const allInc: Record<string, number> = { LAK: 0, THB: 0, USD: 0 };
  const allExp: Record<string, number> = { LAK: 0, THB: 0, USD: 0 };
  for (const t of dayTxns) {
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
    const coTxns = dayTxns.filter((t) => t.company.id === co.id);
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
  if (companies.length === 0) {
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
// Sheet 7 — ລາຍການເງິນທີ່ໃຊ້ບໍ່ໄດ້
// ============================================================

function buildSheet7Stuck(
  accounts: { id: string; accountName: string; accountType: string; currency: string; openingBalance: Prisma.Decimal; currentBalance: Prisma.Decimal; bank: { code: string }; company: { name: string } }[],
  rates: Record<string, number>,
): { ws: XLSX.WorkSheet; name: string } {
  const stuck = accounts.filter(
    (a) => a.accountType === 'STUCK' || a.accountType === 'COLLATERAL',
  );

  const rows: Row[] = [];
  rows.push(['ຊັບສິນທີ່ໃຊ້ບໍ່ໄດ້ / ຫັກໃວ້', null, null, null, null, null, null]);
  rows.push([]);
  rows.push(['ລ/ດ', 'ລາຍລະອຽດ', 'ບໍລິສັດ', 'ທະນາຄານ', 'ສະກຸນເງິນ', 'ຈຳນວນເງິນ', 'ລວມເປັນເງິນກີບ']);
  const hdrRow = 2;

  let total = 0;
  stuck.forEach((a, i) => {
    const amt = num(a.currentBalance);
    const lak = r2(amt * (rates[a.currency] ?? 1));
    total += lak;
    rows.push([i + 1, a.accountName, a.company.name, a.bank.code, a.currency, amt || null, lak]);
  });
  if (stuck.length === 0) rows.push([1, '(ບໍ່ມີຂໍ້ມູນ)', null, null, null, null, 0]);

  rows.push([]);
  rows.push(['ລວມເງິນທັງໝົດທີ່ຫັກໄວ້', null, null, null, null, null, r2(total)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  styleRange(ws, hdrRow, 0, hdrRow, 6, HEADER_STYLE);
  borderAllCells(ws, hdrRow + 1);
  const lastRow = hdrRow + 1 + Math.max(stuck.length, 1) + 1;
  styleRange(ws, lastRow, 0, lastRow, 6, TOTAL_STYLE);

  ws['!cols'] = [
    { wch: 5 }, { wch: 28 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 18 },
  ];

  return { ws, name: 'ລາຍການເງິນທີ່ໃຊ້ບໍ່ໄດ້' };
}

// ============================================================
// Sheet 8 — ກອງທຶນ ຢາມາໂມໂຕະ
// ============================================================

function buildSheet8Fund(
  txns: TxnWithRels[],
  rates: Record<string, number>,
): { ws: XLSX.WorkSheet; name: string } {
  const fundTxns = txns.filter(
    (t) =>
      t.bankAccount.accountType === 'FUND' ||
      t.bankAccount.accountName.includes('ກອງທຶນ') ||
      t.bankAccount.accountName.toLowerCase().includes('yamamoto'),
  );

  const rows: Row[] = [];
  rows.push(['ລາຍຮັບ-ລາຍຈ່າຍ ກອງທຶນ', null, null, null, null, null, null]);
  rows.push(['ອັດຕາແລກປ່ຽນ', 'LAK', rates.LAK, 'THB', rates.THB, 'USD', rates.USD]);
  rows.push([]);
  rows.push(['ລ/ດ', 'ວ/ດ/ປ', 'ເນື້ອໃນ', 'ສະກຸນເງິນ', 'ຈຳນວນເງິນ', 'ລວມເປັນກີບ', 'ປະເພດ']);
  const hdrRow = 3;

  let running = 0;
  fundTxns.forEach((t, i) => {
    const amt = num(t.amount);
    const sign = t.type === 'INCOME' ? 1 : -1;
    const lak = r2(amt * (rates[t.currency] ?? 1) * sign);
    running += lak;
    rows.push([
      i + 1, fmtDate(t.transactionDate), t.description,
      t.currency, amt, lak,
      t.type === 'INCOME' ? 'ຮັບ' : 'ຈ່າຍ',
    ]);
  });
  if (fundTxns.length === 0) rows.push([null, null, '(ບໍ່ມີຂໍ້ມູນ)', null, null, 0, null]);

  rows.push([]);
  rows.push(['ຍອດເຫຼືອລວມ', null, null, null, null, r2(running), null]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  styleRange(ws, hdrRow, 0, hdrRow, 6, HEADER_STYLE);
  borderAllCells(ws, hdrRow + 1);
  const lastRow = hdrRow + 1 + Math.max(fundTxns.length, 1) + 1;
  styleRange(ws, lastRow, 0, lastRow, 6, TOTAL_STYLE);

  ws['!cols'] = [
    { wch: 5 }, { wch: 13 }, { wch: 36 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 10 },
  ];

  return { ws, name: 'ກອງທຶນ ຢາມາໂມໂຕະ' };
}

// ============================================================
// Sheet 10 — ODSc ຫັກໃວ້ໃຫ້ກະຊວງ 5%
// ============================================================

function buildSheet10Ministry(
  txns: TxnWithRels[],
  accounts: { id: string; accountName: string; accountType: string; openingBalance: Prisma.Decimal; bank: { code: string } }[],
): { ws: XLSX.WorkSheet; name: string } {
  const target = accounts.find(
    (a) =>
      a.accountName.includes('ກະຊວງ') ||
      a.accountName.includes('5%') ||
      a.accountName.toLowerCase().includes('odsc'),
  );

  const rows: Row[] = [];
  rows.push([target ? target.bank.code : 'BCEL', null, null, target?.accountName ?? 'ODSc 5%', null, null, null]);

  const acctTxns = target ? txns.filter((t) => t.bankAccount.id === target.id) : [];
  const opening = target ? num(target.openingBalance) : 0;
  const totalOut = acctTxns.filter((t) => t.type === 'EXPENSE').reduce((s, t) => s + num(t.amount), 0);

  rows.push([null, null, null, 'ຍອດຍົກມາ', r2(opening), 'ລ່າຍຈ່າຍ', r2(totalOut), 'ຍອດເຫຼືອ', r2(opening - totalOut)]);
  rows.push(['ລ/ດ', 'ວັນທີ່', 'ລາຍລະອຽດ', 'ຍອດຍົກມາ', 'ລ່າຍຈ່າຍ', 'ຍອດເຫຼືອ', 'ໝາຍເຫດ']);
  const hdrRow = 2;
  rows.push([null, null, 'ຍອດເປີດ', r2(opening), null, r2(opening), null]);

  let bal = opening;
  acctTxns.forEach((t, i) => {
    const out = t.type === 'EXPENSE' ? num(t.amount) : 0;
    bal -= out;
    rows.push([i + 1, fmtDate(t.transactionDate), t.description, null, out || null, r2(bal), t.note ?? '']);
  });
  if (acctTxns.length === 0) rows.push([null, null, '(ບໍ່ມີຂໍ້ມູນ)', null, null, r2(opening), null]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  styleRange(ws, hdrRow, 0, hdrRow, 6, HEADER_STYLE);
  borderAllCells(ws, hdrRow + 1);

  ws['!cols'] = [
    { wch: 5 }, { wch: 13 }, { wch: 36 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 24 },
  ];

  return { ws, name: 'ODSc ຫັກໃວ້ໃຫ້ກະຊວງ 5%' };
}

// ============================================================
// Sheet 11 — LLL - ໜີ້ຕ້ອງສົ່ງ ພາຈ່າຍ
// ============================================================

function buildSheet11Debts(txns: TxnWithRels[]): { ws: XLSX.WorkSheet; name: string } {
  const debt = txns.filter(
    (t) =>
      (t.category?.name?.includes('ໜີ້') ?? false) ||
      (t.category?.name?.includes('ພາຈ່າຍ') ?? false) ||
      (t.note?.includes('ໜີ້') ?? false) ||
      (t.note?.includes('ພາຈ່າຍ') ?? false),
  );

  const lakSide = debt.filter((t) => t.currency === 'LAK');
  const usdSide = debt.filter((t) => t.currency === 'USD');

  const rows: Row[] = [];
  rows.push(['BCEL — LAK', null, null, null, null, null, null, null, 'JDB — USD', null, null, null, null, null]);

  const lakSum = lakSide.reduce((s, t) => s + num(t.amount), 0);
  const usdSum = usdSide.reduce((s, t) => s + num(t.amount), 0);
  rows.push([null, null, r2(lakSum), 0, r2(lakSum), null, null, null, null, null, r2(usdSum), 0, r2(usdSum), null]);

  rows.push([
    'ລ/ດ', 'ວັນທີ່', 'ຈຳນວນເງິນ', 'ສົ່ງແລ້ວ', 'ຍອດເຫຼືອ', 'ໝາຍເຫດ', null, null,
    'ລ/ດ', 'ວັນທີ່', 'ຈຳນວນເງິນ', 'ສົ່ງແລ້ວ', 'ຍອດເຫຼືອ', 'ໝາຍເຫດ',
  ]);
  const hdrRow = 2;

  const maxRows = Math.max(lakSide.length, usdSide.length, 1);
  let lakBal = 0, usdBal = 0;
  for (let i = 0; i < maxRows; i++) {
    const l = lakSide[i];
    const u = usdSide[i];
    if (l) lakBal += num(l.amount);
    if (u) usdBal += num(u.amount);
    rows.push([
      l ? i + 1 : null, l ? fmtDate(l.transactionDate) : null, l ? num(l.amount) : null,
      null, l ? r2(lakBal) : null, l?.description ?? null, null, null,
      u ? i + 1 : null, u ? fmtDate(u.transactionDate) : null, u ? num(u.amount) : null,
      null, u ? r2(usdBal) : null, u?.description ?? null,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  styleRange(ws, hdrRow, 0, hdrRow, 13, HEADER_STYLE);
  borderAllCells(ws, hdrRow + 1);

  ws['!cols'] = [
    { wch: 5 }, { wch: 13 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 24 }, { wch: 2 }, { wch: 2 },
    { wch: 5 }, { wch: 13 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 24 },
  ];

  return { ws, name: 'LLL - ໜີ້ຕ້ອງສົ່ງ ພາຈ່າຍ' };
}

// ============================================================
// Public entry
// ============================================================

export const exportService = {
  async buildWorkbook(filters: ExportFilters): Promise<Buffer> {
    const { txns, accounts, companies, rates } = await loadData(filters);
    const acctCols = buildAccountColumns(accounts);

    const wb = XLSX.utils.book_new();
    const sheets = [
      buildSheet1Daily(txns, rates, filters),
      buildSheet2Master(txns, acctCols, rates),
      buildSheet3DailyReport(txns, companies, rates, filters),
      buildSheet7Stuck(accounts, rates),
      buildSheet8Fund(txns, rates),
      buildSheet10Ministry(txns, accounts),
      buildSheet11Debts(txns),
    ];

    for (const s of sheets) {
      formatAllNumbers(s.ws);
      XLSX.utils.book_append_sheet(wb, s.ws, s.name.slice(0, 31));
    }

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  },
};
