import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

// Sans import : RedisModule et PrismaModule sont globaux.
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
