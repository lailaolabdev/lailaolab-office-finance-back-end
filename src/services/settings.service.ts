import { Currency } from '@prisma/client';
import { prisma } from '../config/prisma';

export const settingsService = {
  async getAll(category?: string) {
    return prisma.setting.findMany({
      where: category ? { category } : undefined,
      orderBy: { key: 'asc' },
    });
  },

  async get(key: string) {
    return prisma.setting.findUnique({ where: { key } });
  },

  async set(key: string, value: unknown, category?: string) {
    return prisma.setting.upsert({
      where: { key },
      update: { value: value as never, category },
      create: { key, value: value as never, category },
    });
  },

  async setBulk(settings: Array<{ key: string; value?: unknown; category?: string }>) {
    return prisma.$transaction(
      settings.map((s) =>
        prisma.setting.upsert({
          where: { key: s.key },
          update: { value: s.value as never, category: s.category },
          create: { key: s.key, value: s.value as never, category: s.category },
        }),
      ),
    );
  },

  async getLatestExchangeRates() {
    const rates = await prisma.exchangeRate.findMany({
      orderBy: [{ effectiveAt: 'desc' }, { fromCurrency: 'asc' }],
    });
    const seen = new Set<string>();
    return rates.filter((r) => {
      const key = `${r.fromCurrency}-${r.toCurrency}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  async setExchangeRate(data: {
    fromCurrency: Currency;
    toCurrency: Currency;
    rate: number;
    effectiveAt?: Date;
  }) {
    const effectiveAt = data.effectiveAt ?? new Date();
    return prisma.exchangeRate.upsert({
      where: {
        fromCurrency_toCurrency_effectiveAt: {
          fromCurrency: data.fromCurrency,
          toCurrency: data.toCurrency,
          effectiveAt,
        },
      },
      update: { rate: data.rate },
      create: {
        fromCurrency: data.fromCurrency,
        toCurrency: data.toCurrency,
        rate: data.rate,
        effectiveAt,
      },
    });
  },
};
