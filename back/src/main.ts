import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const webUrl = config.get<string>('WEB_URL') ?? 'http://localhost:3000';
  app.setGlobalPrefix('api');
  app.enableCors({ origin: webUrl, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(config.get<string>('API_PORT') ?? 4000);
  await app.listen(port);
  console.log(`SOWEN API running on http://localhost:${port}/api`);
}
bootstrap();
