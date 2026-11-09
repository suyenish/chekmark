import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { SignedInUser } from '../accounts/auth.service.js';
import { CurrentUser, SessionGuard } from '../accounts/session.guard.js';
import type { Mark } from '../generated/prisma/client.js';
import { pageView } from '../library/views.js';
import { MarksService } from './marks.service.js';

const chosenType = z.enum(['underline_save', 'underline_translate', 'curly'], {
  error: 'Choose underline_save, underline_translate or curly',
});
const text = z.string().trim().min(1, 'Enter the marked text').max(500);
const optionalText = z.string().trim().max(1000).nullable().optional();

const editBody = z
  .object({ type: chosenType.optional(), save: z.boolean().optional(), text: text.optional(), normalForm: optionalText, sentence: optionalText })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one change');
const addBody = z.object({ type: chosenType, text, normalForm: optionalText, sentence: optionalText }).strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new BadRequestException(z.prettifyError(result.error));
  return result.data;
}

/** What the web app sees of a mark. `saved` says whether it will become a word bank item. */
const markView = (mark: Mark) => ({
  id: mark.id,
  order: mark.order,
  type: mark.type,
  text: mark.text,
  normalForm: mark.normalForm,
  sentence: mark.sentence,
  position: mark.position,
  source: mark.source,
  saved: mark.type === 'underline_save' || mark.type === 'curly',
});

@Controller()
@UseGuards(SessionGuard)
export class MarksController {
  constructor(private readonly marks: MarksService) {}

  @Get('pages/:id/marks')
  async list(@CurrentUser() user: SignedInUser, @Param('id') pageId: string) {
    return (await this.marks.listMarks(user.id, pageId)).map(markView);
  }

  @Post('pages/:id/marks')
  async add(@CurrentUser() user: SignedInUser, @Param('id') pageId: string, @Body() body: unknown) {
    return markView(await this.marks.addMark(user.id, pageId, parse(addBody, body)));
  }

  @Patch('marks/:id')
  async edit(@CurrentUser() user: SignedInUser, @Param('id') markId: string, @Body() body: unknown) {
    return markView(await this.marks.editMark(user.id, markId, parse(editBody, body)));
  }

  @Delete('marks/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: SignedInUser, @Param('id') markId: string): Promise<void> {
    await this.marks.deleteMark(user.id, markId);
  }

  @Post('pages/:id/confirm')
  @HttpCode(200)
  async confirm(@CurrentUser() user: SignedInUser, @Param('id') pageId: string) {
    return pageView(await this.marks.confirm(user.id, pageId));
  }

  @Post('pages/:id/retry')
  @HttpCode(200)
  async retry(@CurrentUser() user: SignedInUser, @Param('id') pageId: string) {
    return pageView(await this.marks.retry(user.id, pageId));
  }
}
