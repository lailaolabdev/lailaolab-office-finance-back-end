import multer from 'multer';
import { BadRequestError } from '../utils/errors';

const ALLOWED_EXTENSIONS = ['xlsx', 'xls', 'csv'];

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase().split('.').pop() ?? '';
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new BadRequestError('ຮອງຮັບສະເພາະໄຟລ໌ .xlsx, .xls, .csv') as any);
    }
  },
});
