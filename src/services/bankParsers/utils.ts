import { Currency } from '@prisma/client';
import { normalizeCurrency } from '../../utils/currency';

export function parseAmount(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * Parse a cell value into a JS Date. Supports:
 *  - Excel serial numbers (read as numbers)
 *  - ISO strings (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
 *  - DD-MM-YYYY, DD/MM/YYYY, D/M/YY, D/M/YYYY
 *  - DD-MM-YYYY HH:mm:ss [AM|PM]
 *  - YYYY-MM-DD HH:mm:ss
 */
export function parseDateCell(val: unknown): Date | null {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date && !isNaN(val.getTime())) return val;

  if (typeof val === 'number' && val > 10000 && val < 100000) {
    // Excel serial date (days since 1899-12-30)
    return new Date(Math.round((val - 25569) * 86400 * 1000));
  }

  const s = String(val).trim();
  if (!s) return null;

  // ISO already (Y-M-D[ T...]Z?)
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (isoMatch) {
    const [, y, m, d, hh, mm, ss] = isoMatch;
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0), Number(ss ?? 0));
  }

  // DD[-/.]MM[-/.]YYYY [HH:mm:ss [AM|PM]]
  const dmyMatch = s.match(
    /^(\d{1,2})[\-\/\.](\d{1,2})[\-\/\.](\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?)?/i,
  );
  if (dmyMatch) {
    let [, d, m, y, hh, mm, ss, ampm] = dmyMatch;
    let year = Number(y);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    let hour = Number(hh ?? 0);
    if (ampm) {
      const isPm = ampm.toUpperCase() === 'PM';
      if (isPm && hour < 12) hour += 12;
      if (!isPm && hour === 12) hour = 0;
    }
    return new Date(year, Number(m) - 1, Number(d), hour, Number(mm ?? 0), Number(ss ?? 0));
  }

  // Last resort: native Date parse
  const t = new Date(s);
  return isNaN(t.getTime()) ? null : t;
}

export function cellStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

export function findRowIndex(
  rows: unknown[][],
  predicate: (row: unknown[]) => boolean,
  startAt = 0,
  maxScan = 50,
): number {
  const limit = Math.min(rows.length, startAt + maxScan);
  for (let i = startAt; i < limit; i++) {
    if (predicate(rows[i] ?? [])) return i;
  }
  return -1;
}

const CURRENCY_LABEL_INLINE = /^(?:ສະກຸນເງ[ີິ]ນ|currency)\s*[:：]?\s*/iu;

function isCurrencyLabel(cell: string): boolean {
  return (
    cell.startsWith('ສະກຸນເງີນ') ||
    cell.startsWith('ສະກຸນເງິນ') ||
    /^currency\s*:/i.test(cell)
  );
}

function currencyFromLabelCell(cell: string, adjacent: string): Currency | null {
  const inline = cell.replace(CURRENCY_LABEL_INLINE, '');
  return normalizeCurrency(adjacent) ?? normalizeCurrency(inline);
}

/**
 * Extract currency from statement metadata rows (headers before the transaction table).
 * Supports English codes (USD), Lao labels (ໂດລາ, ກີບ), and "Currency : …" patterns.
 */
export function extractCurrencyFromMetaRows(
  rows: unknown[][],
  options?: { maxRows?: number },
): Currency | null {
  const limit = Math.min(rows.length, options?.maxRows ?? 15);
  let currency: Currency | null = null;

  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    for (let j = 0; j < row.length; j++) {
      const c = cellStr(row[j]);
      if (isCurrencyLabel(c)) {
        currency = currencyFromLabelCell(c, cellStr(row[j + 1])) ?? currency;
      }
    }
  }

  if (!currency) {
    const blob = rows
      .slice(0, limit)
      .flat()
      .map((c) => cellStr(c))
      .join(' ');
    const curMatch = blob.match(/Currency\s*:\s*([^\s,|]+)/i);
    if (curMatch) currency = normalizeCurrency(curMatch[1]);
  }

  if (!currency) {
    for (let i = 0; i < limit; i++) {
      for (const cell of rows[i] ?? []) {
        const normalized = normalizeCurrency(cellStr(cell));
        if (normalized) {
          currency = normalized;
          break;
        }
      }
      if (currency) break;
    }
  }

  return currency;
}

/** Read currency from a dedicated column (e.g. "ສະກຸນ" in export files). */
export function extractCurrencyFromColumn(
  rows: unknown[][],
  colIndex: number,
  startRow = 1,
): Currency | null {
  if (colIndex < 0) return null;
  for (let i = startRow; i < rows.length; i++) {
    const normalized = normalizeCurrency(cellStr(rows[i]?.[colIndex]));
    if (normalized) return normalized;
  }
  return null;
}
