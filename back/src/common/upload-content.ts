import { BadRequestException } from '@nestjs/common';

// What a file really is, read from its first bytes. The type announced by the browser and the file name are chosen
// by whoever sends the file, so they are never trusted on their own. Pure, unit-tested (back/test/security.test.ts).

export type DetectedType = { mime: string; extensions: string[] };

const ascii = (buffer: Buffer, start: number, end: number) => buffer.subarray(start, end).toString('latin1');
const startsWith = (buffer: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buffer[offset + i] === b);

export function detectFileType(buffer: Buffer): DetectedType | null {
  if (!buffer || buffer.length < 12) return null;
  // PDF: the header may be preceded by a few bytes, but must be at the very beginning of the file.
  if (ascii(buffer, 0, 1024).indexOf('%PDF-') === 0) return { mime: 'application/pdf', extensions: ['pdf'] };
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'] };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', extensions: ['png'] };
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') return { mime: 'image/webp', extensions: ['webp'] };
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WAVE') return { mime: 'audio/wav', extensions: ['wav'] };
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: 'audio/webm', extensions: ['webm', 'weba'] };
  if (ascii(buffer, 4, 8) === 'ftyp') return { mime: 'audio/mp4', extensions: ['m4a', 'mp4'] };
  if (ascii(buffer, 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && (buffer[1] & 0x06) !== 0)) return { mime: 'audio/mpeg', extensions: ['mp3'] };
  return null;
}

const GENERAL = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm']);
const ALLOWED = { general: GENERAL, pdf: new Set(['application/pdf']) };
export type UploadKind = keyof typeof ALLOWED;

// The name kept for display and download: no path, no control character, and an extension that matches the content
// (a PDF sent as "page.html" is stored as "page.html.pdf").
export function safeDisplayName(name: string, type: DetectedType): string {
  const base = String(name || '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim().slice(0, 180) || 'fichier';
  const extension = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
  return type.extensions.includes(extension) ? base : `${base}.${type.extensions[0]}`;
}

// Checks an uploaded file against its real content and corrects its type and name in place. A file whose content is
// not one of the accepted formats is refused, whatever it claims to be.
export function checkUpload(file: Express.Multer.File, kind: UploadKind): Express.Multer.File {
  const type = file?.buffer ? detectFileType(file.buffer) : null;
  if (!type || !ALLOWED[kind].has(type.mime)) {
    throw new BadRequestException(kind === 'pdf'
      ? 'Ce fichier n’est pas un PDF valide.'
      : 'Type de fichier non pris en charge : seuls les PDF, les images (JPEG, PNG, WebP) et les enregistrements audio sont acceptés. Le contenu du fichier ne correspond à aucun de ces formats.');
  }
  file.mimetype = type.mime;
  file.originalname = safeDisplayName(file.originalname, type);
  return file;
}
