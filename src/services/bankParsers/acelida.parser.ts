import * as XLSX from 'xlsx';
import { BankParser, ParsedRow, ParsedStatement } from './types';
import { cellStr, findRowIndex, parseAmount, parseDateCell } from './utils';

/**
 * ACELIDA Statement Format (best-effort heuristic).
 * No sample yet — accept generic "Date | Description | Debit | Credit | Balance"
 * with the bank name appearing somewhere in metadata rows.
 */
export const acelidaParser: BankParser = {
  template: 'ACELIDA',

  detect(_workbook, rows) {
    const text = rows
      .slice(0, 8)
      .flat()
      .map((c) => cellStr(c).toLowerCase())
      .join(' ');
    return text.includes('acelida') || text.includes('aceleda');
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

    const warnings: string[] = ['ACELIDA: ໃຊ້ heuristic parser — ກວດສອບຂໍ້ມູນກ່ອນບັນທຶກ'];
    const headerIdx = findRowIndex(rows, (row) => {
      const cells = row.map((c) => cellStr(c).toLowerCase());
      return (
        cells.some((c) => c.includes('date')) &&
        (cells.some((c) => c.includes('debit')) || cells.some((c) => c.includes('withdraw'))) &&
        (cells.some((c) => c.includes('credit')) || cells.some((c) => c.includes('deposit')))
      );
    });
    if (headerIdx === -1) {
      warnings.push('ACELIDA: ບໍ່ພົບ header row');
      return empty(warnings);
    }

    const header = (rows[headerIdx] ?? []).map((c) => cellStr(c));
    const find = (...keys: string[]) =>
      header.findIndex((c) => keys.some((k) => c.toLowerCase().includes(k.toLowerCase())));
    const colDate = find('date', 'ວັນທີ');
    const colDesc = find('description', 'detail', 'ລາຍລະອຽດ', 'narration');
    const colRef = find('ref', 'reference');
    const colDebit = find('debit', 'withdraw', 'ໜີ້');
    const colCredit = find('credit', 'deposit', 'ມີ');
    const colBalance = find('balance', 'ຍອດ');

    const out: ParsedRow[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
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
        raw: {},
      });
    }

    return {
      template: 'ACELIDA',
      bankCode: 'ACELIDA',
      accountNumber: null,
      currency: null,
      periodStart: out.length ? out[0].transactionDate : null,
      periodEnd: out.length ? out[out.length - 1].transactionDate : null,
      openingBalance: null,
      closingBalance: out.length ? out[out.length - 1].balance : null,
      rows: out,
      warnings,
    };
  },
};

function empty(warnings: string[]): ParsedStatement {
  return {
    template: 'ACELIDA',
    bankCode: 'ACELIDA',
    accountNumber: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    openingBalance: null,
    closingBalance: null,
    rows: [],
    warnings,
  };
}
