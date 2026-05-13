import { prisma } from '../config/prisma';
import { ConflictError, NotFoundError } from '../utils/errors';

export const companyService = {
  async list() {
    return prisma.company.findMany({
      orderBy: { code: 'asc' },
      include: { _count: { select: { bankAccounts: true } } },
    });
  },

  async getById(id: string) {
    const company = await prisma.company.findUnique({
      where: { id },
      include: { bankAccounts: { include: { bank: true } } },
    });
    if (!company) throw new NotFoundError('Company not found');
    return company;
  },

  async create(data: {
    code: string;
    name: string;
    nameEn?: string;
    taxId?: string;
    address?: string;
    phone?: string;
    email?: string;
  }) {
    const exists = await prisma.company.findUnique({ where: { code: data.code } });
    if (exists) throw new ConflictError('Company code already exists');
    return prisma.company.create({ data });
  },

  async update(id: string, data: Partial<{ name: string; nameEn: string; taxId: string; address: string; phone: string; email: string; isActive: boolean }>) {
    await this.getById(id);
    return prisma.company.update({ where: { id }, data });
  },

  async delete(id: string) {
    await this.getById(id);
    return prisma.company.update({ where: { id }, data: { isActive: false } });
  },
};
