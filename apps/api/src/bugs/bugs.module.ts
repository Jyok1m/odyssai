import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BugsController } from './bugs.controller.js';
import { BugsService } from './bugs.service.js';

// AuthModule apporte SessionGuard ; PrismaModule est global.
@Module({
  imports: [AuthModule],
  controllers: [BugsController],
  providers: [BugsService],
  exports: [BugsService],
})
export class BugsModule {}
