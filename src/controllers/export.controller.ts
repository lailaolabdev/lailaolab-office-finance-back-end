import { Request, Response } from 'express';
import { z } from 'zod';
import { exportService } from '../services/export.service';

const schema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  companyId: z.string().optional(),
});

export const exportController = {
  async bankSummary(req: Request, res: Response) {
    const { from, to, companyId } = schema.parse(req.query);

    const buffer = await exportService.buildWorkbook({
      dateFrom: from,
      dateTo: to,
      companyId,
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
