import { Router } from 'express';
import { exportController } from '../controllers/export.controller';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

// GET /api/v1/export/bank-summary?from=YYYY-MM-DD&to=YYYY-MM-DD&companyId=...
// Downloads the 7-sheet workbook matching the
//   doc/ໂຄງຮ່າງ ສະຫຼຸບ ລາຍຮັບລາຍຈ່າຍ (ຕິດຕາມບັນຊີທະນາຄານ).xlsx template
router.get('/bank-summary', asyncHandler(exportController.bankSummary));

export default router;
