import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { allowedOrigins, apiSecurityHeaders, listenHost } from './common/security';
import { trustProxyHops } from './config.validation';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const env = { NODE_ENV: config.get('NODE_ENV'), PUBLIC_APP_URL: config.get('PUBLIC_APP_URL'), WEB_URL: config.get('WEB_URL'), TRUST_PROXY: config.get('TRUST_PROXY'), API_HOST: config.get('API_HOST') };
  app.disable('x-powered-by');
  // Behind a reverse proxy the client address comes from X-Forwarded-For. It is only trusted when TRUST_PROXY says
  // how many proxies sit in front of the API (e.g. "1"); otherwise anyone could forge it to escape rate limiting.
  const hops = trustProxyHops(env.TRUST_PROXY);
  if (hops > 0) app.set('trust proxy', hops);
  const headers = apiSecurityHeaders(env);
  const origins = allowedOrigins(env);
  app.use((req: Request, res: Response, next: NextFunction) => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    // A browser page of another site is refused outright (requests without an Origin are not browser page calls).
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) {
      res.status(403).json({ statusCode: 403, message: 'Origin not allowed' });
      return;
    }
    next();
  });
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: origins,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = Number(config.get<string>('API_PORT') ?? 4000);
  const host = listenHost(env);
  await app.listen(port, host);
  console.log(`SOWEN API running on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/api`);
}
bootstrap();
