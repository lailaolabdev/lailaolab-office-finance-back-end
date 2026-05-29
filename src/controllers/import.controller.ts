import { Request, Response } from 'express';
import { z } from 'zod';
import { Currency } from '@prisma/client';
import { BadRequestError } from '../utils/errors';
import { importService } from '../services/import.service';
import { ALL_TEMPLATES, BankTemplate } from '../services/bankParsers';
import { normalizeCurrency } from '../utils/currency';

const TEMPLATE_VALUES = ALL_TEMPLATES as readonly BankTemplate[];

export const importController = {
  /**
   * Inspect-only: detects bank template, returns parsed preview without writing.
   * Use this to drive the "Preview & confirm" step in the UI.
   */
  async parse(req: Request, res: Response) {
    if (!req.file) throw new BadRequestError('ກະລຸນາອັບໂຫຼດໄຟລ໌');

    const schema = z.object({
      template: z.enum(TEMPLATE_VALUES as [BankTemplate, ...BankTemplate[]]).optional(),
    });
    const { template } = schema.parse(req.body);

    const parsed = importService.parse(req.file.buffer, template);
    console.log("parsed: ", parsed);  
    res.json({
      data: {
        template: parsed.template,
        bankCode: parsed.bankCode,
        accountNumber: parsed.accountNumber,
        currency: normalizeCurrency(parsed.currency) || parsed.currency,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        openingBalance: parsed.openingBalance,
        closingBalance: parsed.closingBalance,
        totalRows: parsed.rows.length,
        warnings: parsed.warnings,
        rows: parsed.rows.slice(0, 100).map((r) => ({
          rowNumber: r.rowNumber,
          transactionDate: r.transactionDate.toISOString(),
          description: r.description,
          amount: r.amount,
          type: r.type,
          bankReference: r.bankReference,
          balance: r.balance,
        })),
        fileName: req.file.originalname,
      },
    });
  },

  /**
   * Atomic ingest. Returns 409 if the file (by SHA256 hash) was already imported
   * for this bank account. Either the entire batch commits or nothing does.
   */
  async ingest(req: Request, res: Response) {
    if (!req.file) throw new BadRequestError('ກະລຸນາອັບໂຫຼດໄຟລ໌');

    const schema = z.object({
      bankAccountId: z.string().min(1),
      companyId: z.string().min(1),
      template: z.enum(TEMPLATE_VALUES as [BankTemplate, ...BankTemplate[]]).optional(),
      currency: z.enum(['LAK', 'THB', 'USD', 'CNY', 'VND']).optional(),
      defaultCategoryId: z.string().optional(),
      // JSON string: { "rowNumber": "categoryId", ... }
      rowCategories: z.string().optional(),
      // JSON array of row numbers to skip (deleted by user in preview)
      excludedRows: z.string().optional(),
      dryRun: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
    });
    const body = schema.parse(req.body);

    let rowCategories: Record<number, string> | undefined;
    if (body.rowCategories) {
      try {
        rowCategories = JSON.parse(body.rowCategories);
      } catch {
        // ignore malformed — fall back to defaultCategoryId
      }
    }

    let excludedRows: Set<number> | undefined;
    if (body.excludedRows) {
      try {
        const arr: number[] = JSON.parse(body.excludedRows);
        excludedRows = new Set(arr);
      } catch {
        // ignore
      }
    }

    const result = await importService.ingest({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      bankAccountId: body.bankAccountId,
      companyId: body.companyId,
      uploadedById: req.user!.userId,
      forceTemplate: body.template,
      currency: body.currency as Currency | undefined,
      defaultCategoryId: body.defaultCategoryId,
      rowCategories,
      excludedRows,
      dryRun: body.dryRun ?? false,
    });

    res.json({ data: result });
  },

  /**
   * Returns the list of supported bank templates for the UI selector.
   */
  async templates(_req: Request, res: Response) {
    res.json({
      data: ALL_TEMPLATES.map((t) => ({
        code: t,
        label:
          t === 'BCEL'
            ? 'BCEL One (i-Bank)'
            : t === 'JDB'
              ? 'Joint Development Bank'
              : t === 'LDB'
                ? 'Lao Development Bank'
                : t === 'IB'
                  ? 'Industrial Bank (IBONLINE)'
                  : t === 'ACELIDA'
                    ? 'ACELIDA Bank'
                    : 'Generic / Custom',
      })),
    });
  },
};
