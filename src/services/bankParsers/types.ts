import { Currency } from '@prisma/client';

export type BankTemplate = 'BCEL' | 'JDB' | 'LDB' | 'IB' | 'ACELIDA' | 'GENERIC';

export interface ParsedRow {
  rowNumber: number;
  transactionDate: Date;
  description: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  bankReference: string | null;
  balance: number | null;
  raw: Record<string, unknown>;
}

export interface ParsedStatement {
  template: BankTemplate;
  bankCode: string | null;
  accountNumber: string | null;
  currency: Currency | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  openingBalance: number | null;
  closingBalance: number | null;
  rows: ParsedRow[];
  warnings: string[];
}

export interface BankParser {
  template: BankTemplate;
  detect(workbook: unknown, firstSheetRows: unknown[][]): boolean;
  parse(workbook: unknown, sheetName: string): ParsedStatement;
}
