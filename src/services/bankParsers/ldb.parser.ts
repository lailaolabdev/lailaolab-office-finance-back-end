import * as XLSX from 'xlsx';
import { BankParser, ParsedRow, ParsedStatement } from './types';
import { cellStr, findRowIndex, parseAmount, parseDateCell } from './utils';

/**
 * LDB Statement Format
 * - Row 0: title "ລາຍງານບັນຊີStatement of Account YYYY-MM-DD - YYYY-MM-DD"
 * - Row 1: account meta merged into a few cells
 * - Header row contains "ວັນທີDate Time" / "ເນື້ອໃນການເຄື່ອນໄຫວDescription" / "ຫນີ້Withdraw" / "ມີDeposit"
 * - Data rows follow, last row is "Total Withdraws: ... Total Deposit: ... Closing Balance: ..."
 * - Date format: M/D/YY
 */
export const ldbParser: BankParser = {
  template: 'LDB',

  detect(_workbook, rows) {
    const text = rows
      .slice(0, 5)
      .flat()
      .map((c) => cellStr(c).toLowerCase())
      .join(' ');
    return text.includes('ldb bil id') || text.includes('phapay') || text.includes('statement of account');
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

    const meta = extractLdbMeta(rows);
    const warnings: string[] = [];

    const headerIdx = findRowIndex(rows, (row) => {
      const joined = row.map((c) => cellStr(c)).join(' ');
      return joined.includes('Withdraw') && joined.includes('Deposit');
    });
    if (headerIdx === -1) {
      warnings.push('LDB: ບໍ່ພົບ header row (Withdraw/Deposit)');
      return empty(meta, warnings);
    }

    const header = (rows[headerIdx] ?? []).map((c) => cellStr(c));
    const colDate = header.findIndex((c) => c.includes('Date'));
    const colDesc = header.findIndex((c) => c.includes('Description'));
    const colRef = header.findIndex((c) => c.toLowerCase().includes('bil') || c.toLowerCase().includes('id'));
    const colDebit = header.findIndex((c) => c.includes('Withdraw'));
    const colCredit = header.findIndex((c) => c.includes('Deposit'));
    const colBalance = header.findIndex((c) => c.includes('Balance'));

    const out: ParsedRow[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const firstCell = cellStr(row[0]);
      // Skip totals row at end
      if (firstCell.startsWith('Total') || firstCell.includes('Closing Balance')) continue;
      const date = parseDateCell(row[colDate]);
      if (!date) continue;
      const debit = parseAmount(row[colDebit]);
      const credit = parseAmount(row[colCredit]);
      if (debit === 0 && credit === 0) continue;

      const isIncome = credit > 0;
      out.push({
        rowNumber: i + 1,
        transactionDate: date,
        description: cellStr(row[colDesc]) || '(no description)',
        amount: isIncome ? credit : debit,
        type: isIncome ? 'INCOME' : 'EXPENSE',
        bankReference: colRef >= 0 ? cellStr(row[colRef]) || null : null,
        balance: colBalance >= 0 ? parseAmount(row[colBalance]) : null,
        raw: { date: cellStr(row[colDate]) },
      });
    }

    return {
      template: 'LDB',
      bankCode: 'LDB',
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

interface LdbMeta {
  accountNumber: string | null;
  currency: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  openingBalance: number | null;
}

function extractLdbMeta(rows: unknown[][]): LdbMeta {
  const meta: LdbMeta = {
    accountNumber: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    openingBalance: null,
  };
  const blob = rows
    .slice(0, 4)
    .flat()
    .map((c) => cellStr(c))
    .join(' ');

  const accMatch = blob.match(/account:\s*(\d+)/i) || blob.match(/ບັນຊີ\s*\/\s*account:\s*(\d+)/i);
  if (accMatch) meta.accountNumber = accMatch[1];

  const periodMatch = blob.match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
  if (periodMatch) {
    meta.periodStart = parseDateCell(periodMatch[1]);
    meta.periodEnd = parseDateCell(periodMatch[2]);
  }

  const balMatch = blob.match(/From previous balance:\s*([\d,\.]+)/i);
  if (balMatch) meta.openingBalance = parseAmount(balMatch[1]);

  const curMatch = blob.match(/Currency\s*:\s*(\w+)/i);
  if (curMatch) meta.currency = curMatch[1].toUpperCase();

  return meta;
}

function empty(meta: LdbMeta, warnings: string[]): ParsedStatement {
  return {
    template: 'LDB',
    bankCode: 'LDB',
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
