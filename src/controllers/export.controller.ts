import { Request, Response } from 'express';
import { z } from 'zod';
import { exportService } from '../services/export.service';

const arrayOrSingle = z.preprocess(
  (val) => (Array.isArray(val) ? val : val !== undefined && val !== null ? [val] : undefined),
  z.array(z.string()).optional(),
);

const schema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  companyId: z.string().optional(),
  type: z.enum(['daily', 'daily-report', 'stuck']).optional(),
  companyIds: arrayOrSingle,
  itemIds: arrayOrSingle,
});

export const exportController = {
  async bankSummary(req: Request, res: Response) {
    const { from, to, companyId, type, companyIds, itemIds } = schema.parse(req.query);

    const buffer = await exportService.buildWorkbook({
      dateFrom: from,
      dateTo: to,
      companyId,
      type,
      companyIds,
      itemIds,
    });

    const filename = `bank-summary_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  },
};
