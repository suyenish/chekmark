import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { WordbankController } from './wordbank.controller.js';
import { WordbankService } from './wordbank.service.js';

@Module({
  imports: [AccountsModule],
  controllers: [WordbankController],
  providers: [WordbankService],
})
export class WordbankModule {}
