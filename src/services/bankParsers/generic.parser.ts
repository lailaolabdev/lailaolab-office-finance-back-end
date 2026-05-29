import * as XLSX from 'xlsx';
import { BankParser, ParsedRow, ParsedStatement } from './types';
import { cellStr, extractCurrencyFromColumn, extractCurrencyFromMetaRows, parseAmount, parseDateCell } from './utils';

/**
 * Generic fallback parser. Used when no bank-specific format matches —
 * also supports the system's own export ("transactions.xlsx") with columns:
 * ວັນທີ | Reference | ປະເພດ | ລາຍລະອຽດ | ໝວດ | ທະນາຄານ | ເລກບັນຊີ | ຈຳນວນ | ສະກຸນ | ສະຖານະ | ໝາຍເຫດ | Bank Ref
 *
 * Heuristic: row 0 is header. We try to map columns by keyword.
 */
export const genericParser: BankParser = {
  template: 'GENERIC',

  detect() {
    return true; // always last
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
    const warnings: string[] = ['Generic parser — ກະລຸນາກວດສອບ column mapping'];

    if (rows.length < 2) {
      warnings.push('ໄຟລ໌ບໍ່ມີຂໍ້ມູນ');
      return empty(warnings, extractCurrencyFromMetaRows(rows));
    }

    const header = (rows[0] ?? []).map((c) => cellStr(c));
    const find = (...keys: string[]) =>
      header.findIndex((c) =>
        keys.some((k) => c.toLowerCase() === k.toLowerCase() || c.toLowerCase().includes(k.toLowerCase())),
      );

    const colDate = find('date', 'ວັນທີ', 'วันที่');
    const colDesc = find('description', 'detail', 'ລາຍລະອຽດ', 'รายการ', 'narration', 'memo');
    const colAmount = find('amount', 'ຈຳນວນ', 'จำนวน', 'value');
    const colDebit = find('debit', 'withdraw', 'ໜີ້', 'ออก', 'dr');
    const colCredit = find('credit', 'deposit', 'ມີ', 'เข้า', 'cr');
    const colType = find('type', 'ປະເພດ', 'ประเภท');
    const colRef = find('reference', 'ref', 'ອ້າງອີງ', 'bank ref');
    const colNote = find('note', 'remark', 'ໝາຍເຫດ', 'หมายเหตุ');
    const colCurrency = find('currency', 'ສະກຸນ', 'สกุล');

    const currency =
      extractCurrencyFromMetaRows(rows) ?? extractCurrencyFromColumn(rows, colCurrency);

    if (colDate === -1) {
      warnings.push('ບໍ່ພົບ column ວັນທີ');
      return empty(warnings, currency);
    }

    const useDebitCredit = colDebit >= 0 && colCredit >= 0;

    const out: ParsedRow[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const date = parseDateCell(row[colDate]);
      if (!date) continue;

      let amount = 0;
      let type: 'INCOME' | 'EXPENSE' = 'EXPENSE';

      if (useDebitCredit) {
        const debit = parseAmount(row[colDebit]);
        const credit = parseAmount(row[colCredit]);
        if (debit === 0 && credit === 0) continue;
        if (credit > 0) {
          amount = credit;
          type = 'INCOME';
        } else {
          amount = debit;
          type = 'EXPENSE';
        }
      } else if (colAmount >= 0) {
        amount = Math.abs(parseAmount(row[colAmount]));
        if (amount === 0) continue;
        if (colType >= 0) {
          const t = cellStr(row[colType]).toUpperCase();
          if (t.includes('IN') || t.includes('CR') || t.includes('ຮັບ')) type = 'INCOME';
          else if (t.includes('EX') || t.includes('DR') || t.includes('ຈ່າຍ')) type = 'EXPENSE';
        }
      } else {
        continue;
      }

      out.push({
        rowNumber: i + 1,
        transactionDate: date,
        description: (colDesc >= 0 ? cellStr(row[colDesc]) : '') || '(no description)',
        amount,
        type,
        bankReference: colRef >= 0 ? cellStr(row[colRef]) || null : null,
        balance: null,
        raw: { note: colNote >= 0 ? cellStr(row[colNote]) : '' },
      });
    }

    return {
      template: 'GENERIC',
      bankCode: null,
      accountNumber: null,
      currency,
      periodStart: out.length ? out[0].transactionDate : null,
      periodEnd: out.length ? out[out.length - 1].transactionDate : null,
      openingBalance: null,
      closingBalance: null,
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
    template: 'GENERIC',
    bankCode: null,
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
