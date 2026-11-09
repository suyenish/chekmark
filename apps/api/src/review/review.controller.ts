import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { SignedInUser } from '../accounts/auth.service.js';
import { CurrentUser, SessionGuard } from '../accounts/session.guard.js';
import { ReviewService } from './review.service.js';
import { RATINGS, type Rating } from './scheduler.js';

const rateBody = z.object({ rating: z.enum(RATINGS as [Rating, ...Rating[]], { error: 'Rate with again, hard or easy' }) });

@Controller('review')
@UseGuards(SessionGuard)
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get('due')
  due(@CurrentUser() user: SignedInUser) {
    return this.review.due(user.id, new Date());
  }

  @Post(':cardId')
  @HttpCode(200)
  rate(@CurrentUser() user: SignedInUser, @Param('cardId') cardId: string, @Body() body: unknown) {
    const result = rateBody.safeParse(body ?? {});
    if (!result.success) throw new BadRequestException(z.prettifyError(result.error));
    return this.review.rate(user.id, cardId, result.data.rating, new Date());
  }
}
