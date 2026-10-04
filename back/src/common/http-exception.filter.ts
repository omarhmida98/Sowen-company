import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { redactTokens } from '../portal/portal-tokens';

export const INTERNAL_ERROR = 'Une erreur interne est survenue. Réessayez dans quelques instants.';
// Errors raised below Nest (body parser, …) carry an HTTP status of their own. Their text is not echoed.
const CLIENT_ERRORS: Record<number, string> = { 400: 'Requête invalide.', 413: 'Requête trop volumineuse.', 415: 'Format de requête non pris en charge.' };

// What the client receives for an error. Only errors the application raised on purpose (HttpException) keep their
// message; anything else is an internal failure: it is logged with a reference and the client gets a generic text.
export function clientError(exception: unknown, newId: () => string = randomUUID): { status: number; body: { statusCode: number; message: unknown; errorId?: string }; internal: boolean } {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const res = exception.getResponse();
    const message = typeof res === 'string' ? res : ((res as { message?: unknown }).message ?? 'Error');
    return { status, body: { statusCode: status, message }, internal: false };
  }
  const raw = exception as { status?: unknown; statusCode?: unknown } | null;
  const status = Number(raw?.status ?? raw?.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) return { status, body: { statusCode: status, message: CLIENT_ERRORS[status] ?? CLIENT_ERRORS[400] }, internal: false };
  return { status: 500, body: { statusCode: 500, message: INTERNAL_ERROR, errorId: newId() }, internal: true };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ method: string; url: string }>();
    // Links that act as credentials are never written to the log nor echoed back.
    const url = redactTokens(request.url);
    const { status, body, internal } = clientError(exception);

    if (internal) {
      // The details stay on the server: the reference lets an administrator find them from what the user reports.
      const err = exception as { message?: unknown; stack?: unknown };
      this.logger.error(`HTTP ${request.method} ${url} → 500 [${body.errorId}]: ${typeof err?.message === 'string' ? err.message : 'unknown error'}`, (err?.stack as string) || String(exception));
    } else {
      this.logger.warn(`HTTP ${request.method} ${url} → ${status}: ${JSON.stringify(body.message)}`);
    }
    response.status(status).json({ ...body, path: url, timestamp: new Date().toISOString() });
  }
}
