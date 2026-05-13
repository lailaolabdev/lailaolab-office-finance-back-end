import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '../src/config/prisma';
import { authService } from '../src/services/auth.service';
import { companyService } from '../src/services/company.service';
import { bankAccountService } from '../src/services/bankAccount.service';
import { transactionService } from '../src/services/transaction.service';
import {
  UnauthorizedError,
  ConflictError,
  NotFoundError,
} from '../src/utils/errors';
import { TEST_PREFIX, cleanupTestRecords } from './helpers';

describe('Service-layer error paths', () => {
  let bcelId: string;
  let companyId: string;
  let bankAccountId: string;
  let adminId: string;

  beforeAll(async () => {
    await cleanupTestRecords();
    const bcel = await prisma.bank.findUnique({ where: { code: 'BCEL' } });
    if (!bcel) throw new Error('BCEL bank not seeded');
    bcelId = bcel.id;

    const admin = await prisma.user.findUnique({ where: { email: 'admin@lailaolab.com' } });
    if (!admin) throw new Error('Admin not seeded');
    adminId = admin.id;

    const co = await companyService.create({ code: `${TEST_PREFIX}SVC`, name: 'SvcCo' });
    companyId = co.id;

    const acc = await bankAccountService.create({
      companyId,
      bankId: bcelId,
      accountNumber: `${TEST_PREFIX}ACC`,
      accountName: 'Svc Acc',
      openingBalance: 1000,
    });
    bankAccountId = acc.id;
  });

  afterAll(async () => {
    await cleanupTestRecords();
    await prisma.$disconnect();
  });

  describe('authService', () => {
    it('login with unknown email throws UnauthorizedError', async () => {
      await expect(authService.login('nobody@example.com', 'whatever')).rejects.toThrow(UnauthorizedError);
    });

    it('login with wrong password throws UnauthorizedError', async () => {
      await expect(authService.login('admin@lailaolab.com', 'wrong')).rejects.toThrow(UnauthorizedError);
    });

    it('refresh with invalid token throws UnauthorizedError', async () => {
      await expect(authService.refresh('not-a-token')).rejects.toThrow(UnauthorizedError);
    });

    it('register existing email throws ConflictError', async () => {
      await expect(
        authService.register({
          email: 'admin@lailaolab.com',
          password: 'pwpw1234',
          fullName: 'X',
        }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('companyService', () => {
    it('getById of unknown id throws NotFoundError', async () => {
      await expect(companyService.getById('does-not-exist')).rejects.toThrow(NotFoundError);
    });

    it('create with duplicate code throws ConflictError', async () => {
      await expect(companyService.create({ code: `${TEST_PREFIX}SVC`, name: 'Dup' })).rejects.toThrow(
        ConflictError,
      );
    });
  });

  describe('bankAccountService', () => {
    it('getById of unknown id throws NotFoundError', async () => {
      await expect(bankAccountService.getById('does-not-exist')).rejects.toThrow(NotFoundError);
    });

    it('create with duplicate (company, bank, accountNumber) throws ConflictError', async () => {
      await expect(
        bankAccountService.create({
          companyId,
          bankId: bcelId,
          accountNumber: `${TEST_PREFIX}ACC`,
          accountName: 'Dup',
        }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('transactionService', () => {
    it('getById of unknown id throws NotFoundError', async () => {
      await expect(transactionService.getById('does-not-exist')).rejects.toThrow(NotFoundError);
    });

    it('create + balance increment + duplicate detection', async () => {
      const created = await transactionService.create({
        companyId,
        bankAccountId,
        type: 'INCOME',
        transactionDate: new Date('2026-01-15'),
        amount: 250,
        description: 'svc-test income',
        bankReference: `${TEST_PREFIX}REF1`,
        createdById: adminId,
      });
      expect(created.id).toBeTruthy();
      expect(created.reference.startsWith('IN-')).toBe(true);

      // Balance bumped from 1000 → 1250
      const acc = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
      expect(Number(acc?.currentBalance)).toBe(1250);

      // Duplicate (same date+amount+account+bankRef) is rejected
      await expect(
        transactionService.create({
          companyId,
          bankAccountId,
          type: 'INCOME',
          transactionDate: new Date('2026-01-15'),
          amount: 250,
          description: 'dup',
          bankReference: `${TEST_PREFIX}REF1`,
          createdById: adminId,
        }),
      ).rejects.toThrow(ConflictError);

      // Cleanup created txn so its reference isn't pinned by the FK indirectly
      await prisma.transaction.deleteMany({ where: { id: created.id } });
      await prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: { currentBalance: 1000 },
      });
    });

    it('void of non-existent transaction throws NotFoundError', async () => {
      await expect(transactionService.void('nope', 'reason', adminId)).rejects.toThrow(NotFoundError);
    });

    it('update adjusts balance by delta and writes activity log', async () => {
      const created = await transactionService.create({
        companyId,
        bankAccountId,
        type: 'INCOME',
        transactionDate: new Date('2026-02-10'),
        amount: 100,
        description: 'svc-test update src',
        bankReference: `${TEST_PREFIX}REF_UPD`,
        createdById: adminId,
      });
      const accBefore = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
      expect(Number(accBefore?.currentBalance)).toBe(1100); // 1000 + 100

      const updated = await transactionService.update(
        created.id,
        { amount: 150, description: 'svc-test update edited' },
        adminId,
      );
      expect(updated.description).toBe('svc-test update edited');
      const accAfter = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } });
      expect(Number(accAfter?.currentBalance)).toBe(1150); // bumped by +50

      const log = await prisma.activityLog.findFirst({
        where: { entityType: 'Transaction', entityId: created.id, action: 'UPDATE_TRANSACTION' },
      });
      expect(log).not.toBeNull();

      // Cleanup
      await prisma.activityLog.deleteMany({ where: { entityId: created.id } });
      await prisma.transaction.delete({ where: { id: created.id } });
      await prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: { currentBalance: 1000 },
      });
    });

    it('update of voided transaction throws ConflictError', async () => {
      const created = await transactionService.create({
        companyId,
        bankAccountId,
        type: 'INCOME',
        transactionDate: new Date('2026-02-11'),
        amount: 50,
        description: 'svc-test voided',
        bankReference: `${TEST_PREFIX}REF_VOID`,
        createdById: adminId,
      });
      await transactionService.void(created.id, 'test void', adminId);

      await expect(
        transactionService.update(created.id, { amount: 75 }, adminId),
      ).rejects.toThrow(ConflictError);

      // Cleanup
      await prisma.activityLog.deleteMany({ where: { entityId: created.id } });
      await prisma.transaction.delete({ where: { id: created.id } });
    });
  });
});
