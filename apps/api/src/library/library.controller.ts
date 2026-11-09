import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  StreamableFile,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {} from 'multer'; // adds the Express.Multer.File type
import { z } from 'zod';
import type { SignedInUser } from '../accounts/auth.service.js';
import { CurrentUser, SessionGuard } from '../accounts/session.guard.js';
import type { Book } from '../generated/prisma/client.js';
import { isJpeg, MAX_PHOTO_BYTES } from '../photos/photo-store.js';
import { type BookWithPageCount, LibraryService } from './library.service.js';
import { pageView } from './views.js';

const bookBody = z.object({ title: z.string().trim().min(1, 'Enter a title').max(200) });
const pageFields = z.object({
  pageNumber: z
    .string({ error: 'Enter the page number' })
    .regex(/^\d+$/, 'The page number must be a whole number')
    .transform(Number)
    .pipe(z.number().int().min(1, 'The page number must be 1 or more').max(100_000)),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(z.prettifyError(result.error));
  return result.data;
}

const bookView = (book: Book | BookWithPageCount) => ({
  id: book.id,
  title: book.title,
  sourceLanguage: book.sourceLanguage,
  createdAt: book.createdAt,
  ...('pageCount' in book ? { pageCount: book.pageCount } : {}),
});

@Controller()
@UseGuards(SessionGuard)
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get('books')
  async listBooks(@CurrentUser() user: SignedInUser) {
    return (await this.library.listBooks(user.id)).map(bookView);
  }

  @Post('books')
  async createBook(@CurrentUser() user: SignedInUser, @Body() body: unknown) {
    return bookView(await this.library.createBook(user.id, parse(bookBody, body).title));
  }

  @Get('books/:id')
  async getBook(@CurrentUser() user: SignedInUser, @Param('id') id: string) {
    return bookView(await this.library.getBook(user.id, id));
  }

  @Patch('books/:id')
  async renameBook(@CurrentUser() user: SignedInUser, @Param('id') id: string, @Body() body: unknown) {
    return bookView(await this.library.renameBook(user.id, id, parse(bookBody, body).title));
  }

  @Delete('books/:id')
  @HttpCode(204)
  async deleteBook(@CurrentUser() user: SignedInUser, @Param('id') id: string): Promise<void> {
    await this.library.deleteBook(user.id, id);
  }

  @Get('books/:id/pages')
  async listPages(@CurrentUser() user: SignedInUser, @Param('id') id: string) {
    return (await this.library.listPages(user.id, id)).map(pageView);
  }

  /** Multipart form: `photo` (a JPEG file, at most 10 MB) and `pageNumber`. */
  @Post('books/:id/pages')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  async createPage(
    @CurrentUser() user: SignedInUser,
    @Param('id') id: string,
    @UploadedFile() photo: Express.Multer.File | undefined,
    @Body() fields: unknown,
  ) {
    await this.library.getBook(user.id, id); // someone else's book is a 404 before anything else
    if (!photo) throw new BadRequestException('Add a photo of the page');
    const { pageNumber } = parse(pageFields, fields);
    // The browser's content type can be anything: only the file's first bytes decide.
    if (!isJpeg(photo.buffer)) {
      throw new UnsupportedMediaTypeException('Only JPEG photos are accepted. The app converts photos to JPEG before uploading.');
    }
    return pageView(await this.library.createPage(user.id, id, pageNumber, photo.buffer));
  }

  @Get('pages/:id')
  async getPage(@CurrentUser() user: SignedInUser, @Param('id') id: string) {
    return pageView(await this.library.getPage(user.id, id));
  }

  @Get('pages/:id/photo')
  async getPhoto(@CurrentUser() user: SignedInUser, @Param('id') id: string): Promise<StreamableFile> {
    const photo = await this.library.getPagePhoto(user.id, id);
    return new StreamableFile(photo, { type: 'image/jpeg', length: photo.length });
  }
}
