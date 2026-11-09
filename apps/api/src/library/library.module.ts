import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { LibraryController } from './library.controller.js';
import { LibraryService } from './library.service.js';
import { ResultsService } from './results.service.js';

@Module({
  imports: [AccountsModule],
  controllers: [LibraryController],
  providers: [LibraryService, ResultsService],
  exports: [LibraryService],
})
export class LibraryModule {}
