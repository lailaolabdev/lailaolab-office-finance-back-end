import * as XLSX from 'xlsx';
import { BankParser, ParsedRow, ParsedStatement } from './types';
import { cellStr, extractCurrencyFromMetaRows, findRowIndex, parseAmount, parseDateCell } from './utils';

/**
 * JDB Statement Format
 * - Header row 0: ລຳດັບ | ວັນທີເຮັດທຸລະກຳ | ວັນທີໃນຄໍແບ້ງ | ເລກທີລາຍການ | ລະຫັດ | ລາຍລະອຽດ | ຍອດເດບິດ | ຍອດເຄຼດິດ | ຍອດເຫຼືອ
 * - Date format: "04-05-2026 00:02:26 AM" (DD-MM-YYYY HH:mm:ss AM/PM)
 */
export const jdbParser: BankParser = {
  template: 'JDB',

  detect(_workbook, rows) {
    const header = (rows[0] ?? []).map((c) => cellStr(c));
    return (
      header.includes('ວັນທີເຮັດທຸລະກຳ') &&
      header.includes('ຍອດເດບິດ') &&
      header.includes('ຍອດເຄຼດິດ')
    );
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

    const warnings: string[] = [];
    const currency = extractCurrencyFromMetaRows(rows);
    const headerIdx = findRowIndex(rows, (row) => {
      const cells = row.map((c) => cellStr(c));
      return cells.includes('ວັນທີເຮັດທຸລະກຳ') && cells.includes('ຍອດເດບິດ');
    });
    if (headerIdx === -1) {
      warnings.push('JDB: ບໍ່ພົບ header row');
      return empty('JDB', warnings, currency);
    }

    const header = (rows[headerIdx] ?? []).map((c) => cellStr(c));
    const colDate = header.indexOf('ວັນທີເຮັດທຸລະກຳ');
    const colRef = header.indexOf('ເລກທີລາຍການ');
    const colDesc = header.indexOf('ລາຍລະອຽດ');
    const colDebit = header.indexOf('ຍອດເດບິດ');
    const colCredit = header.indexOf('ຍອດເຄຼດິດ');
    const colBalance = header.indexOf('ຍອດເຫຼືອ');

    const out: ParsedRow[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const dateRaw = row[colDate];
      const date = parseDateCell(dateRaw);
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
        bankReference: cellStr(row[colRef]) || null,
        balance: colBalance >= 0 ? parseAmount(row[colBalance]) : null,
        raw: { date: cellStr(dateRaw), ref: cellStr(row[colRef]) },
      });
    }

    return {
      template: 'JDB',
      bankCode: 'JDB',
      accountNumber: null,
      currency,
      periodStart: out.length ? out[0].transactionDate : null,
      periodEnd: out.length ? out[out.length - 1].transactionDate : null,
      openingBalance: null,
      closingBalance: out.length ? out[out.length - 1].balance : null,
      rows: out,
      warnings,
    };
  },
};

function empty(
  template: 'JDB',
  warnings: string[],
  currency: ParsedStatement['currency'] = null,
): ParsedStatement {
  return {
    template,
    bankCode: 'JDB',
    accountNumber: null,
    currency,
    periodStart: null,
    periodEnd: null,
    openingBalance: null,
    closingBalance: null,
    rows: [],
    warnings,
  };
}
