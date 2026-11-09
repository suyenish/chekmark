import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';

@Module({
  imports: [AccountsModule],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}
