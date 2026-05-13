import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { ConflictError, NotFoundError } from '../utils/errors';

export const userService = {
  async list() {
    return prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  },

  async getById(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) throw new NotFoundError('User not found');
    return user;
  },

  async create(data: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
    role: UserRole;
  }) {
    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new ConflictError('Email already in use');

    const hashed = await bcrypt.hash(data.password, 10);
    return prisma.user.create({
      data: {
        email: data.email,
        password: hashed,
        fullName: data.fullName,
        phone: data.phone,
        role: data.role,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  },

  async update(
    id: string,
    data: {
      fullName?: string;
      phone?: string;
      role?: UserRole;
      isActive?: boolean;
      password?: string;
    },
  ) {
    await this.getById(id);
    const payload: Record<string, unknown> = {};
    if (data.fullName !== undefined) payload.fullName = data.fullName;
    if (data.phone !== undefined) payload.phone = data.phone;
    if (data.role !== undefined) payload.role = data.role;
    if (data.isActive !== undefined) payload.isActive = data.isActive;
    if (data.password) payload.password = await bcrypt.hash(data.password, 10);

    return prisma.user.update({
      where: { id },
      data: payload,
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  },

  async delete(id: string) {
    await this.getById(id);
    return prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
  },
};
