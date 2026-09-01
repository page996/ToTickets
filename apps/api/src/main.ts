import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RUNTIME_CONFIG, RuntimeConfig } from './config/runtime-config';
import { ConfiguredWsAdapter } from './events/configured-ws.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<RuntimeConfig>(RUNTIME_CONFIG);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      errorHttpStatusCode: 422,
      stopAtFirstError: false,
    }),
  );
  app.enableCors({
    origin: [...config.api.allowedOrigins],
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['content-type', 'idempotency-key', 'x-request-id', 'x-operator-id'],
    credentials: false,
  });
  app.useWebSocketAdapter(new ConfiguredWsAdapter(app, config));
  app.enableShutdownHooks();
  await app.listen(config.api.port, config.api.bindHost);
}

void bootstrap();
