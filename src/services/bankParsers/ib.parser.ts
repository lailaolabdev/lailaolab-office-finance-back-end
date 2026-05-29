import * as XLSX from 'xlsx';
import { BankParser, ParsedRow, ParsedStatement } from './types';
import { cellStr, extractCurrencyFromMetaRows, findRowIndex, parseAmount, parseDateCell } from './utils';

/**
 * IB (Industrial Bank) — Online Statement Format
 * - Sheet name: "Online Statement"
 * - Header row 0: No | Bank Date | TXN Date | Ref No | TXN Ref | Description | Debit | Credit | Balance | Channel
 * - Date format: DD-MM-YYYY (Bank Date) or DD-MM-YYYY HH:mm:ss (TXN Date)
 * - Debit/Credit columns: "0" or formatted number
 */
export const ibParser: BankParser = {
  template: 'IB',

  detect(_workbook, rows) {
    const header = (rows[0] ?? []).map((c) => cellStr(c));
    const channel0 = (rows[1] ?? [])[9] ?? '';
    return (
      (header.includes('Bank Date') &&
        header.includes('TXN Date') &&
        header.includes('Debit') &&
        header.includes('Credit')) ||
      cellStr(channel0).toUpperCase() === 'IBONLINE'
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
      return cells.includes('Bank Date') && cells.includes('Debit') && cells.includes('Credit');
    });
    if (headerIdx === -1) {
      warnings.push('IB: ບໍ່ພົບ header row');
      return empty(warnings, currency);
    }

    const header = (rows[headerIdx] ?? []).map((c) => cellStr(c));
    const colBankDate = header.indexOf('Bank Date');
    const colTxnDate = header.indexOf('TXN Date');
    const colRef = header.indexOf('Ref No');
    const colTxnRef = header.indexOf('TXN Ref');
    const colDesc = header.indexOf('Description');
    const colDebit = header.indexOf('Debit');
    const colCredit = header.indexOf('Credit');
    const colBalance = header.indexOf('Balance');

    const out: ParsedRow[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      // prefer TXN Date (more granular), fall back to Bank Date
      const date = parseDateCell(row[colTxnDate]) ?? parseDateCell(row[colBankDate]);
      if (!date) continue;
      const debit = parseAmount(row[colDebit]);
      const credit = parseAmount(row[colCredit]);
      if (debit === 0 && credit === 0) continue;

      const isIncome = credit > 0;
      const refNo = cellStr(row[colRef]);
      const txnRef = cellStr(row[colTxnRef]);
      out.push({
        rowNumber: i + 1,
        transactionDate: date,
        description: cellStr(row[colDesc]) || '(no description)',
        amount: isIncome ? credit : debit,
        type: isIncome ? 'INCOME' : 'EXPENSE',
        bankReference: refNo || txnRef || null,
        balance: colBalance >= 0 ? parseAmount(row[colBalance]) : null,
        raw: { txnRef, bankDate: cellStr(row[colBankDate]) },
      });
    }

    return {
      template: 'IB',
      bankCode: 'IB',
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
  warnings: string[],
  currency: ParsedStatement['currency'] = null,
): ParsedStatement {
  return {
    template: 'IB',
    bankCode: 'IB',
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
