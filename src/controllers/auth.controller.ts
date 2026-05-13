import { Request, Response } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(2),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

export const authController = {
  async login(req: Request, res: Response) {
    const { email, password } = loginSchema.parse(req.body);
    const result = await authService.login(email, password);
    res.json({ success: true, data: result });
  },

  async register(req: Request, res: Response) {
    const data = registerSchema.parse(req.body);
    const user = await authService.register(data);
    res.status(201).json({ success: true, data: user });
  },

  async refresh(req: Request, res: Response) {
    const { refreshToken } = refreshSchema.parse(req.body);
    const tokens = await authService.refresh(refreshToken);
    res.json({ success: true, data: tokens });
  },

  async me(req: Request, res: Response) {
    res.json({ success: true, data: req.user });
  },
};
