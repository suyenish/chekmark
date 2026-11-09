import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { SignedInUser } from '../accounts/auth.service.js';
import { CurrentUser, SessionGuard } from '../accounts/session.guard.js';
import { WordbankService } from './wordbank.service.js';

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(['word', 'grammar']).optional(),
});
const optionalText = z.string().trim().max(2000).nullable().optional();
const editBody = z
  .object({
    senseId: z.string({ error: 'Say which meaning to edit (senseId)' }),
    meaning: z.string().trim().min(1, 'The meaning cannot be empty').max(500).optional(),
    notes: optionalText,
    example: optionalText,
    exampleTranslation: optionalText,
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw new BadRequestException(z.prettifyError(result.error));
  return result.data;
}

@Controller('wordbank')
@UseGuards(SessionGuard)
export class WordbankController {
  constructor(private readonly wordbank: WordbankService) {}

  @Get()
  list(@CurrentUser() user: SignedInUser, @Query() query: unknown) {
    return this.wordbank.list(user.id, parse(listQuery, query));
  }

  @Get(':id')
  get(@CurrentUser() user: SignedInUser, @Param('id') id: string) {
    return this.wordbank.get(user.id, id);
  }

  @Patch(':id')
  edit(@CurrentUser() user: SignedInUser, @Param('id') id: string, @Body() body: unknown) {
    return this.wordbank.editSense(user.id, id, parse(editBody, body));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: SignedInUser, @Param('id') id: string): Promise<void> {
    await this.wordbank.delete(user.id, id);
  }
}
