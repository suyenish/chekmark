import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MarksController } from './marks.controller.js';
import { MarksService } from './marks.service.js';

@Module({
  imports: [AccountsModule],
  controllers: [MarksController],
  providers: [MarksService],
})
export class MarksModule {}
