import { Request, Response } from 'express';
import { z } from 'zod';
import { Currency } from '@prisma/client';
import { settingsService } from '../services/settings.service';

const currencies = Object.values(Currency) as [string, ...string[]];

const setSchema = z.object({
  key: z.string().min(1),
  value: z.any(),
  category: z.string().optional(),
});

const bulkSchema = z.array(setSchema);

const exchangeRateSchema = z.object({
  fromCurrency: z.enum(currencies),
  toCurrency: z.enum(currencies),
  rate: z.number().positive(),
  effectiveAt: z.string().datetime().optional(),
});

export const settingsController = {
  async list(req: Request, res: Response) {
    const category = req.query.category as string | undefined;
    const settings = await settingsService.getAll(category);
    res.json({ success: true, data: settings });
  },

  async get(req: Request, res: Response) {
    const setting = await settingsService.get(req.params.key);
    res.json({ success: true, data: setting });
  },

  async set(req: Request, res: Response) {
    const data = setSchema.parse(req.body);
    const setting = await settingsService.set(data.key, data.value, data.category);
    res.json({ success: true, data: setting });
  },

  async setBulk(req: Request, res: Response) {
    const data = bulkSchema.parse(req.body);
    const settings = await settingsService.setBulk(data);
    res.json({ success: true, data: settings });
  },

  async listExchangeRates(_req: Request, res: Response) {
    const rates = await settingsService.getLatestExchangeRates();
    res.json({ success: true, data: rates });
  },

  async setExchangeRate(req: Request, res: Response) {
    const data = exchangeRateSchema.parse(req.body);
    const rate = await settingsService.setExchangeRate({
      fromCurrency: data.fromCurrency as Currency,
      toCurrency: data.toCurrency as Currency,
      rate: data.rate,
      effectiveAt: data.effectiveAt ? new Date(data.effectiveAt) : undefined,
    });
    res.json({ success: true, data: rate });
  },
};
