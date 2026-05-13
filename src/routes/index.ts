import { Router } from 'express';
import authRoutes from './auth.routes';
import companyRoutes from './company.routes';
import bankAccountRoutes from './bankAccount.routes';
import bankRoutes from './bank.routes';
import categoryRoutes from './category.routes';
import subCategoryRoutes from './subCategory.routes';
import transactionRoutes from './transaction.routes';
import dashboardRoutes from './dashboard.routes';
import importRoutes from './import.routes';
import userRoutes from './user.routes';
import settingsRoutes from './settings.routes';
import notificationRoutes from './notification.routes';
import exportRoutes from './export.routes';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.use('/auth', authRoutes);
router.use('/companies', companyRoutes);
router.use('/bank-accounts', bankAccountRoutes);
router.use('/banks', bankRoutes);
router.use('/categories', categoryRoutes);
router.use('/sub-categories', subCategoryRoutes);
router.use('/transactions', transactionRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/import', importRoutes);
router.use('/users', userRoutes);
router.use('/settings', settingsRoutes);
router.use('/notifications', notificationRoutes);
router.use('/export', exportRoutes);

export default router;
