import * as XLSX from 'xlsx';
import { BankParser, BankTemplate, ParsedStatement } from './types';
import { cellStr } from './utils';
import { bcelParser } from './bcel.parser';
import { jdbParser } from './jdb.parser';
import { ldbParser } from './ldb.parser';
import { ibParser } from './ib.parser';
import { acelidaParser } from './acelida.parser';
import { genericParser } from './generic.parser';

export type { BankTemplate, ParsedRow, ParsedStatement } from './types';

const PARSERS: BankParser[] = [bcelParser, jdbParser, ldbParser, ibParser, acelidaParser];

export function detectBankTemplate(buffer: Buffer): {
  template: BankTemplate;
  workbook: XLSX.WorkBook;
  sheetName: string;
} {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('ໄຟລ໌ບໍ່ມີ sheet');

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  });

  for (const parser of PARSERS) {
    if (parser.detect(workbook, rows)) {
      return { template: parser.template, workbook, sheetName };
    }
  }
  return { template: 'GENERIC', workbook, sheetName };
}

export function parseStatement(
  buffer: Buffer,
  forcedTemplate?: BankTemplate,
): ParsedStatement {
  const { workbook, sheetName, template } = detectBankTemplate(buffer);
  const useTemplate = forcedTemplate ?? template;
  const parser =
    PARSERS.find((p) => p.template === useTemplate) ??
    (useTemplate === 'GENERIC' ? genericParser : genericParser);
  return parser.parse(workbook, sheetName);
}

export function parserForTemplate(template: BankTemplate): BankParser {
  if (template === 'GENERIC') return genericParser;
  return PARSERS.find((p) => p.template === template) ?? genericParser;
}

export const ALL_TEMPLATES: BankTemplate[] = ['BCEL', 'JDB', 'LDB', 'IB', 'ACELIDA', 'GENERIC'];

// re-export for advanced use
export { cellStr };
