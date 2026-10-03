import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  // Behind a reverse proxy the client address comes from X-Forwarded-For. It is only trusted when TRUST_PROXY says
  // how many proxies sit in front of the API (e.g. "1"); otherwise anyone could forge it to escape rate limiting.
  const trustProxy = (config.get<string>('TRUST_PROXY') ?? '').trim();
  if (/^\d+$/.test(trustProxy) && Number(trustProxy) > 0) app.set('trust proxy', Number(trustProxy));
  const webUrls = (config.get<string>('WEB_URL') ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      if (!origin || webUrls.includes(origin)) callback(null, true);
      else callback(new Error('Origin not allowed by CORS'));
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = Number(config.get<string>('API_PORT') ?? 4000);
  await app.listen(port);
  console.log(`SOWEN API running on http://localhost:${port}/api`);
}
bootstrap();
