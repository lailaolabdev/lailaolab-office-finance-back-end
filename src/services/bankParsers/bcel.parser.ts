import * as XLSX from 'xlsx';
import { BankParser, ParsedRow, ParsedStatement } from './types';
import { cellStr, findRowIndex, parseAmount, parseDateCell } from './utils';

/**
 * BCEL Statement Format
 * - Sheet usually named "Sheet0"
 * - Rows 0-10 contain bank metadata (account number, name, period, currency)
 * - Header row contains: ວັນທີ | ເລກບີນ | ເນື້ອໃນ | ໜີ້ | ມີ | ຍອດເຫຼືອທ້າຍ
 * - Data rows follow until end (last row may be totals)
 */
export const bcelParser: BankParser = {
  template: 'BCEL',

  detect(_workbook, rows) {
    // BCEL statements have these markers in the *header* metadata rows (rows 0–10)
    // — not just the description column. We require both a BCEL identifier
    // AND the BCEL-specific column header within the first 15 rows.
    const headerBlob = rows
      .slice(0, 12)
      .flat()
      .map((c) => cellStr(c).toLowerCase())
      .join(' | ');
    const hasBcelMarker =
      headerBlob.includes('via bcel') ||
      headerBlob.includes('ທະນາຄານການຄ້າຕ່າງປະເທດລາວ') ||
      headerBlob.includes('ບັນຊີສໍາຮອງ') ||
      headerBlob.includes('branch code');

    const hasBcelHeader = rows.slice(0, 20).some((row) => {
      const cells = row.map((c) => cellStr(c));
      return (
        cells.includes('ວັນທີ') &&
        cells.includes('ໜີ້') &&
        cells.includes('ມີ') &&
        cells.includes('ເນື້ອໃນ')
      );
    });

    return hasBcelMarker && hasBcelHeader;
  },

  parse(workbook, sheetName) {
    const wb = workbook as XLSX.WorkBook;
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
      dateNF: 'yyyy-mm-dd',
    });

    const meta = extractBcelMeta(rows);

    // Find header row (contains ວັນທີ + ໜີ້ + ມີ)
    const headerIdx = findRowIndex(rows, (row) => {
      const cells = row.map((c) => cellStr(c));
      return (
        cells.some((c) => c === 'ວັນທີ') &&
        cells.some((c) => c === 'ໜີ້') &&
        cells.some((c) => c === 'ມີ')
      );
    });

    const warnings: string[] = [];
    if (headerIdx === -1) {
      warnings.push('BCEL: ບໍ່ພົບ header row (ວັນທີ/ໜີ້/ມີ)');
      return blankResult('BCEL', meta, warnings);
    }

    const header = (rows[headerIdx] ?? []).map((c) => cellStr(c));
    const colDate = header.indexOf('ວັນທີ');
    const colRef = header.indexOf('ເລກບີນ');
    const colDesc = header.indexOf('ເນື້ອໃນ');
    const colDebit = header.indexOf('ໜີ້');
    const colCredit = header.indexOf('ມີ');
    const colBalance = header.findIndex((c) => c.startsWith('ຍອດເຫຼືອ'));

    const out: ParsedRow[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const dateRaw = row[colDate];
      const description = cellStr(row[colDesc]);
      const debit = parseAmount(row[colDebit]);
      const credit = parseAmount(row[colCredit]);

      const dateStr = cellStr(dateRaw);

      // Skip footer/summary rows (no date) and known summary markers
      if (!dateStr && description.includes('ຍອດຍົກມາ')) continue;
      if (description.startsWith('Total')) continue;
      if (description.startsWith('ລວມຍອດ')) continue;
      if (dateStr.startsWith('ວັນທີ:') || dateStr.includes('Page')) continue;
      // BCEL footer: "ຍອດເຫຼືອທ້າຍ" appears in column 0 with the closing balance in col 1
      if (dateStr.startsWith('ຍອດເຫຼືອທ້າຍ')) continue;

      const date = parseDateCell(dateRaw);
      if (!date) continue;
      if (debit === 0 && credit === 0) continue;

      const isIncome = credit > 0;
      out.push({
        rowNumber: i + 1,
        transactionDate: date,
        description: description || '(no description)',
        amount: isIncome ? credit : debit,
        type: isIncome ? 'INCOME' : 'EXPENSE',
        bankReference: cellStr(row[colRef]) || null,
        balance: colBalance >= 0 ? parseAmount(row[colBalance]) : null,
        raw: { date: cellStr(dateRaw), ref: cellStr(row[colRef]), description, debit, credit },
      });
    }

    return {
      template: 'BCEL',
      bankCode: 'BCEL',
      accountNumber: meta.accountNumber,
      currency: meta.currency,
      periodStart: meta.periodStart,
      periodEnd: meta.periodEnd,
      openingBalance: meta.openingBalance,
      closingBalance: out.length ? out[out.length - 1].balance : null,
      rows: out,
      warnings,
    };
  },
};

interface BcelMeta {
  accountNumber: string | null;
  currency: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  openingBalance: number | null;
}

function extractBcelMeta(rows: unknown[][]): BcelMeta {
  let accountNumber: string | null = null;
  let currency: string | null = null;
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  let openingBalance: number | null = null;

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i] ?? [];
    for (let j = 0; j < row.length; j++) {
      const c = cellStr(row[j]);
      if (c.startsWith('ເລກບັນຊີ')) {
        accountNumber = cellStr(row[j + 1]) || accountNumber;
      }
      if (c.startsWith('ສະກຸນເງີນ') || c.startsWith('ສະກຸນເງິນ')) {
        const v = cellStr(row[j + 1]);
        if (v.includes('ກີບ') || v.toUpperCase().includes('LAK')) currency = 'LAK';
        else if (v.toUpperCase().includes('USD')) currency = 'USD';
        else if (v.toUpperCase().includes('THB')) currency = 'THB';
        else if (v.toUpperCase().includes('CNY')) currency = 'CNY';
        else if (v.toUpperCase().includes('VND')) currency = 'VND';
      }
      if (c.startsWith('ແຕ່ວັນທີ')) {
        const m = c.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
        if (m) periodStart = parseDateCell(m[1]);
        const next = cellStr(row[j + 1]);
        const m2 = next.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
        if (m2) periodEnd = parseDateCell(m2[1]);
      }
      if (c === 'ຍອດຍົກມາ') {
        openingBalance = parseAmount(row[j + 3] ?? row[row.length - 1]);
      }
    }
  }

  return { accountNumber, currency, periodStart, periodEnd, openingBalance };
}

function blankResult(template: 'BCEL', meta: BcelMeta, warnings: string[]): ParsedStatement {
  return {
    template,
    bankCode: 'BCEL',
    accountNumber: meta.accountNumber,
    currency: meta.currency,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    openingBalance: meta.openingBalance,
    closingBalance: null,
    rows: [],
    warnings,
  };
}
