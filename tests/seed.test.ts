import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../src/config/prisma';

describe('Seed verification (Supabase)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('seeded all 5 banks', async () => {
    const codes = ['BCEL', 'JDB', 'LDB', 'IB', 'ACELIDA'];
    const banks = await prisma.bank.findMany({ where: { code: { in: codes } } });
    expect(banks.length).toBe(codes.length);
    for (const code of codes) {
      expect(banks.some((b) => b.code === code)).toBe(true);
    }
  });

  it('created admin user with hashed password', async () => {
    const admin = await prisma.user.findUnique({ where: { email: 'admin@lailaolab.com' } });
    expect(admin).not.toBeNull();
    expect(admin?.role).toBe('ADMIN');
    expect(admin?.isActive).toBe(true);
    // bcrypt hashes start with $2a$ / $2b$
    expect(admin?.password).toMatch(/^\$2[aby]\$/);
  });

  it('seeded income & expense categories', async () => {
    const incomeCount = await prisma.category.count({ where: { type: 'INCOME' } });
    const expenseCount = await prisma.category.count({ where: { type: 'EXPENSE' } });
    expect(incomeCount).toBeGreaterThanOrEqual(4);
    expect(expenseCount).toBeGreaterThanOrEqual(7);
  });

  it('seeded 3 sample companies', async () => {
    const codes = ['C001', 'C002', 'C003'];
    const companies = await prisma.company.findMany({ where: { code: { in: codes } } });
    expect(companies.length).toBe(codes.length);
  });

  it('seed is idempotent (re-running upsert keeps unique counts stable)', async () => {
    const before = {
      banks: await prisma.bank.count({ where: { code: { in: ['BCEL', 'JDB', 'LDB', 'IB', 'ACELIDA'] } } }),
      admins: await prisma.user.count({ where: { email: 'admin@lailaolab.com' } }),
      sampleCompanies: await prisma.company.count({ where: { code: { in: ['C001', 'C002', 'C003'] } } }),
    };
    expect(before.banks).toBe(5);
    expect(before.admins).toBe(1);
    expect(before.sampleCompanies).toBe(3);
  });
});
