import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { redactTokens } from '../portal/portal-tokens';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ method: string; url: string }>();
    // Links that act as credentials are never written to the log nor echoed back.
    const url = redactTokens(request.url);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message = typeof res === 'string' ? res : ((res as { message?: unknown }).message ?? 'Error');
      this.logger.warn(`HTTP ${request.method} ${url} → ${status}: ${JSON.stringify(message)}`);
      response.status(status).json({ statusCode: status, message, path: url, timestamp: new Date().toISOString() });
      return;
    }

    const err = exception as { message?: unknown; stack?: unknown };
    const message =
      typeof err?.message === 'string' && err.message.trim() ? err.message : 'Internal server error';
    this.logger.error(`HTTP ${request.method} ${url} → 500: ${message}`, (err?.stack as string) || String(exception));
    response.status(500).json({ statusCode: 500, message, path: url, timestamp: new Date().toISOString() });
  }
}