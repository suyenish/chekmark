import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from './config/config.module.js';
import { LibraryModule } from './library/library.module.js';
import { PhotosModule } from './photos/photos.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, PhotosModule, AccountsModule, LibraryModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
