import { Global, Module } from '@nestjs/common';
import { AppConfig } from './app-config.js';
import { GuideConfig } from './guide-config.js';

@Global()
@Module({
  providers: [AppConfig, GuideConfig],
  exports: [AppConfig, GuideConfig],
})
export class ConfigModule {}
