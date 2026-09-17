import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { ErasureModule } from './erasure/erasure.module.js';
import { ModerationModule } from './moderation/moderation.module.js';
import { GuideModule } from './guide/guide.module.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { TurnModule } from './turn/turn.module.js';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    PrismaModule,
    ErasureModule,
    AuthModule,
    GuideModule,
    OnboardingModule,
    ModerationModule,
    TurnModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
