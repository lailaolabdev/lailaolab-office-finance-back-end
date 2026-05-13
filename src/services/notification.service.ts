import { NotificationType, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { NotFoundError } from '../utils/errors';
import { emailService } from './email.service';
import { settingsService } from './settings.service';
import logger from '../utils/logger';

interface CreateNotificationInput {
  userId: string;
  type?: NotificationType;
  title: string;
  message: string;
  link?: string;
  sendEmail?: boolean;
}

interface ListFilters {
  isRead?: boolean;
  page?: number;
  pageSize?: number;
}

async function shouldSendEmailFor(type: NotificationType): Promise<boolean> {
  const globalToggle = await settingsService.get('notification.emailEnabled');
  if (globalToggle?.value !== true) return false;

  // Map notification type → setting key. If the per-type toggle is missing,
  // assume the user wants email for it.
  const map: Partial<Record<NotificationType, string>> = {
    APPROVAL_REQUEST: 'notification.approvalAlert',
    LOW_BALANCE: 'notification.lowBalanceAlert',
    DAILY_REMINDER: 'notification.dailyReminder',
  };
  const settingKey = map[type];
  if (!settingKey) return true;
  const perType = await settingsService.get(settingKey);
  return perType?.value !== false;
}

export const notificationService = {
  async create(input: CreateNotificationInput) {
    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type ?? 'INFO',
        title: input.title,
        message: input.message,
        link: input.link,
      },
    });

    if (input.sendEmail ?? true) {
      const user = await prisma.user.findUnique({ where: { id: input.userId } });
      if (user?.email && (await shouldSendEmailFor(notification.type))) {
        const link = input.link
          ? `<p><a href="${process.env.APP_URL ?? 'http://localhost:3000'}${input.link}">ເບິ່ງລາຍລະອຽດ</a></p>`
          : '';
        await emailService.send({
          to: user.email,
          subject: `[Lailaolab Office] ${input.title}`,
          html: `<h3>${input.title}</h3><p>${input.message}</p>${link}`,
        });
      }
    }

    return notification;
  },

  /**
   * Create the same notification for every user matching the given roles.
   * Skips the invoking user so an approver doesn't notify themselves.
   */
  async notifyByRoles(
    roles: UserRole[],
    payload: Omit<CreateNotificationInput, 'userId'>,
    excludeUserId?: string,
  ) {
    const users = await prisma.user.findMany({
      where: {
        role: { in: roles },
        isActive: true,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: { id: true },
    });

    return Promise.all(users.map((u) => this.create({ ...payload, userId: u.id })));
  },

  async list(userId: string, filters: ListFilters = {}) {
    const { page = 1, pageSize = 20, isRead } = filters;
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(isRead !== undefined ? { isRead } : {}),
    };

    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      items,
      unreadCount,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  },

  async unreadCount(userId: string) {
    return prisma.notification.count({ where: { userId, isRead: false } });
  },

  async markRead(id: string, userId: string) {
    const n = await prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== userId) throw new NotFoundError('Notification not found');
    return prisma.notification.update({ where: { id }, data: { isRead: true } });
  },

  async markAllRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  },

  async delete(id: string, userId: string) {
    const n = await prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== userId) throw new NotFoundError('Notification not found');
    await prisma.notification.delete({ where: { id } });
  },

  async deleteAllRead(userId: string) {
    return prisma.notification.deleteMany({ where: { userId, isRead: true } });
  },

  /**
   * Scan all active bank accounts and emit a LOW_BALANCE notification to
   * managers/accountants when an account drops below the configured threshold.
   * Suppresses duplicates: skips accounts that already triggered an unread
   * LOW_BALANCE notification in the last 24h.
   */
  async checkLowBalance() {
    const enabled = await settingsService.get('notification.lowBalanceAlert');
    if (enabled?.value === false) return { checked: 0, alerted: 0 };

    const thresholdSetting = await settingsService.get('notification.lowBalanceThreshold');
    const threshold = Number(thresholdSetting?.value ?? 1_000_000);

    const accounts = await prisma.bankAccount.findMany({
      where: { isActive: true, accountType: 'USABLE' },
      include: { company: true, bank: true },
    });

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let alerted = 0;

    for (const acc of accounts) {
      if (Number(acc.currentBalance) >= threshold) continue;

      const dup = await prisma.notification.findFirst({
        where: {
          type: 'LOW_BALANCE',
          createdAt: { gte: oneDayAgo },
          message: { contains: acc.accountNumber },
        },
      });
      if (dup) continue;

      const title = 'ຍອດເງິນຕ່ຳ';
      const message = `ບັນຊີ ${acc.bank.code} ${acc.accountNumber} (${acc.company.name}) ມີຍອດ ${Number(
        acc.currentBalance,
      ).toLocaleString()} ${acc.currency} — ຕ່ຳກວ່າຂີດກຳນົດ ${threshold.toLocaleString()}`;

      await this.notifyByRoles(['ADMIN', 'MANAGER', 'ACCOUNTANT_LEAD'], {
        type: 'LOW_BALANCE',
        title,
        message,
        link: `/bank-accounts`,
      });
      alerted++;
    }

    logger.info(`Low balance check: ${accounts.length} accounts, ${alerted} alerted`);
    return { checked: accounts.length, alerted };
  },

  /**
   * Daily reminder to all active staff to complete the day's summary. Skips
   * if the user setting is off.
   */
  async sendDailyReminder() {
    const enabled = await settingsService.get('notification.dailyReminder');
    if (enabled?.value === false) return { sent: 0 };

    const users = await prisma.user.findMany({
      where: { isActive: true, role: { in: ['ACCOUNTANT_LEAD', 'FINANCE_STAFF', 'MANAGER'] } },
      select: { id: true },
    });

    const today = new Date().toLocaleDateString('lo-LA');
    await Promise.all(
      users.map((u) =>
        this.create({
          userId: u.id,
          type: 'DAILY_REMINDER',
          title: 'ເຮັດສະຫຼຸບປະຈຳວັນ',
          message: `ກະລຸນາສະຫຼຸບລາຍຮັບ-ລາຍຈ່າຍ ປະຈຳວັນ ${today}`,
          link: '/dashboard',
        }),
      ),
    );

    logger.info(`Daily reminder sent to ${users.length} users`);
    return { sent: users.length };
  },
};
