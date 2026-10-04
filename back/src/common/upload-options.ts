import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { BadRequestException } from '@nestjs/common';

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

// The announced type is only a first filter: the content is checked once the file is read (upload-content.ts).
export const generalUploadOptions: MulterOptions = {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (allowedGeneralMimeTypes.has(file.mimetype)) return cb(null, true);
    cb(new BadRequestException('Unsupported file type') as unknown as Error, false);
  },
};

export const pdfUploadOptions: MulterOptions = {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    if (ok) return cb(null, true);
    cb(new BadRequestException('Only PDF files are supported') as unknown as Error, false);
  },
};
