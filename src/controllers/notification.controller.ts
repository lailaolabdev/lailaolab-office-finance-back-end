import { Request, Response } from 'express';
import { z } from 'zod';
import { notificationService } from '../services/notification.service';
import { UnauthorizedError } from '../utils/errors';

const listSchema = z.object({
  isRead: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().default(1),
  pageSize: z.coerce.number().default(20),
});

export const notificationController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const filters = listSchema.parse(req.query);
    const result = await notificationService.list(req.user.userId, filters);
    res.json({ success: true, ...result });
  },

  async unreadCount(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const count = await notificationService.unreadCount(req.user.userId);
    res.json({ success: true, data: { count } });
  },

  async markRead(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const n = await notificationService.markRead(req.params.id, req.user.userId);
    res.json({ success: true, data: n });
  },

  async markAllRead(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const result = await notificationService.markAllRead(req.user.userId);
    res.json({ success: true, data: { updated: result.count } });
  },

  async delete(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    await notificationService.delete(req.params.id, req.user.userId);
    res.json({ success: true });
  },

  async deleteAllRead(req: Request, res: Response) {
    if (!req.user) throw new UnauthorizedError();
    const result = await notificationService.deleteAllRead(req.user.userId);
    res.json({ success: true, data: { deleted: result.count } });
  },

  // Admin-only manual triggers (useful for testing without waiting for cron)
  async triggerLowBalance(_req: Request, res: Response) {
    const result = await notificationService.checkLowBalance();
    res.json({ success: true, data: result });
  },

  async triggerDailyReminder(_req: Request, res: Response) {
    const result = await notificationService.sendDailyReminder();
    res.json({ success: true, data: result });
  },
};
