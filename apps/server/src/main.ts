import 'reflect-metadata';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/config';

/** Middleware and pipes shared by `main` and the tests. */
export function configure(app: INestApplication) {
  const config = app.get(AppConfig);
  const express = app as NestExpressApplication;
  const trust = config.get('TRUST_PROXY');
  if (trust !== undefined) express.set('trust proxy', trust);
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const origin = config.get('WEB_ORIGIN');
  // same origin in dev (Vite proxy) and behind a reverse proxy; CORS only when the web app lives elsewhere
  if (origin) app.enableCors({ origin, credentials: true });
  app.enableShutdownHooks();
  return config;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = configure(app);
  const port = config.get('PORT');
  await app.listen(port);
  console.log(`pattern server on http://localhost:${port}/api`);
}

if (require.main === module) void bootstrap();
