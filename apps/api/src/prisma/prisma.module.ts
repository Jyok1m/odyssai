import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { createPrismaClient, PrismaClient } from '@odyssai/db';

export const PRISMA = Symbol('PRISMA');

@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        // L'adaptateur vit dans @odyssai/db : c'est lui qui sait comment on
        // se connecte a cette base, et le worker s'y branchera pareil.
        return createPrismaClient(config.postgresUrl);
      },
    },
  ],
  exports: [PRISMA],
})
export class PrismaModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
