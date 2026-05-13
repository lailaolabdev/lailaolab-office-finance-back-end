import { Request, Response } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { userService } from '../services/user.service';

const roleEnum = z.nativeEnum(UserRole);

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(1),
  phone: z.string().optional(),
  role: roleEnum,
});

const updateSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().optional(),
  role: roleEnum.optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

export const userController = {
  async list(_req: Request, res: Response) {
    const users = await userService.list();
    res.json({ success: true, data: users });
  },

  async get(req: Request, res: Response) {
    const user = await userService.getById(req.params.id);
    res.json({ success: true, data: user });
  },

  async create(req: Request, res: Response) {
    const data = createSchema.parse(req.body);
    const user = await userService.create(data);
    res.status(201).json({ success: true, data: user });
  },

  async update(req: Request, res: Response) {
    const data = updateSchema.parse(req.body);
    const user = await userService.update(req.params.id, data);
    res.json({ success: true, data: user });
  },

  async delete(req: Request, res: Response) {
    await userService.delete(req.params.id);
    res.json({ success: true });
  },
};
