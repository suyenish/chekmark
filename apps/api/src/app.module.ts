import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, AccountsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
