import { Currency } from '@prisma/client';

export function normalizeCurrency(raw: string | null | undefined): Currency | null {
  if (!raw) return null;
  // Keep english letters, numbers, and lao/thai characters
  const s = raw.toLowerCase().replace(/[^\w\u0E00-\u0E7F\u0E80-\u0EFF]/g, '').trim();
  
  if (/usd|ໂດລາ|โดลา|ໂດລ່າ|usdt|us/i.test(s)) return Currency.USD;
  if (/thb|ບາດ|บาท/i.test(s)) return Currency.THB;
  if (/cny|ຢວນ|หยวน/i.test(s)) return Currency.CNY;
  if (/vnd|ດົງ|ดง/i.test(s)) return Currency.VND;
  if (/lak|ກີບ|กีบ|kip/i.test(s)) return Currency.LAK;
  
  // exact match fallback
  if (s === 'usd' || s === 'usdt') return Currency.USD;
  if (s === 'thb') return Currency.THB;
  if (s === 'cny') return Currency.CNY;
  if (s === 'vnd') return Currency.VND;
  if (s === 'lak') return Currency.LAK;

  return null;
}
