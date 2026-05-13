import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/config/prisma';
import { signAccessToken } from '../src/utils/jwt';

export const TEST_PREFIX = 'TST_';

export async function getAdminAccessToken() {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@lailaolab.com' } });
  if (!admin) throw new Error('Admin user not found — did you run pnpm db:seed?');
  return signAccessToken({ userId: admin.id, email: admin.email, role: admin.role });
}

export async function ensureTestUser(email: string, role: UserRole = UserRole.FINANCE_STAFF) {
  const password = await bcrypt.hash('test123456', 10);
  return prisma.user.upsert({
    where: { email },
    update: { isActive: true, role, password },
    create: { email, password, fullName: `Test ${role}`, role },
  });
}

export async function cleanupTestRecords() {
  // Delete in dependency order to respect FKs.
  await prisma.transaction.deleteMany({ where: { reference: { startsWith: TEST_PREFIX } } });
  await prisma.bankAccount.deleteMany({ where: { accountNumber: { startsWith: TEST_PREFIX } } });
  await prisma.company.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.category.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX.toLowerCase() } } });
}
