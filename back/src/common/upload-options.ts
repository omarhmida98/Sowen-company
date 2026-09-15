import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const allowedGeneralMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/webm',
]);

export const generalUploadOptions: MulterOptions = {
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (allowedGeneralMimeTypes.has(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type'), false);
  },
};

export const pdfUploadOptions: MulterOptions = {
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    if (ok) return cb(null, true);
    cb(new Error('Only PDF files are supported'), false);
  },
};
