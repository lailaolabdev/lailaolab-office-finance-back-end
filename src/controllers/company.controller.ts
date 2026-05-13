import { Request, Response } from 'express';
import { z } from 'zod';
import { companyService } from '../services/company.service';

const createSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().optional(),
  taxId: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const companyController = {
  async list(_req: Request, res: Response) {
    const companies = await companyService.list();
    res.json({ success: true, data: companies });
  },
  async get(req: Request, res: Response) {
    const company = await companyService.getById(req.params.id);
    res.json({ success: true, data: company });
  },
  async create(req: Request, res: Response) {
    const data = createSchema.parse(req.body);
    const company = await companyService.create(data);
    res.status(201).json({ success: true, data: company });
  },
  async update(req: Request, res: Response) {
    const data = updateSchema.parse(req.body);
    const company = await companyService.update(req.params.id, data);
    res.json({ success: true, data: company });
  },
  async delete(req: Request, res: Response) {
    await companyService.delete(req.params.id);
    res.json({ success: true });
  },
};
