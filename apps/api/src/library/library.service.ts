import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UsageService } from '../accounts/usage.service.js';
import type { Book, Page } from '../generated/prisma/client.js';
import { PAGE_QUEUE, type PageQueue } from '../jobs/queues.js';
import { PHOTO_STORE, PhotoNotFoundError, type PhotoStore, pagePhotoKey } from '../photos/photo-store.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type BookWithPageCount = Book & { pageCount: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Books and their pages. Every method takes the signed-in user's ID and treats
 * someone else's book or page exactly like one that does not exist (404).
 */
@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PHOTO_STORE) private readonly photos: PhotoStore,
    @Inject(PAGE_QUEUE) private readonly queue: PageQueue,
    private readonly usage: UsageService,
  ) {}

  async listBooks(userId: string): Promise<BookWithPageCount[]> {
    const books = await this.prisma.book.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { pages: true } } },
    });
    return books.map(({ _count, ...book }) => ({ ...book, pageCount: _count.pages }));
  }

  createBook(userId: string, title: string): Promise<Book> {
    return this.prisma.book.create({ data: { userId, title } });
  }

  async getBook(userId: string, bookId: string): Promise<Book> {
    const book = UUID.test(bookId) ? await this.prisma.book.findFirst({ where: { id: bookId, userId } }) : null;
    if (!book) throw new NotFoundException('Book not found');
    return book;
  }

  async renameBook(userId: string, bookId: string, title: string): Promise<Book> {
    await this.getBook(userId, bookId);
    return this.prisma.book.update({ where: { id: bookId }, data: { title } });
  }

  /** Deletes the photos first, so a failure never leaves a photo without a page pointing to it. */
  async deleteBook(userId: string, bookId: string): Promise<void> {
    await this.getBook(userId, bookId);
    const pages = await this.prisma.page.findMany({ where: { bookId, photoDeletedAt: null }, select: { photoKey: true } });
    await Promise.all(pages.map((page) => this.photos.delete(page.photoKey)));
    await this.prisma.book.delete({ where: { id: bookId } });
  }

  async listPages(userId: string, bookId: string): Promise<Page[]> {
    await this.getBook(userId, bookId);
    return this.prisma.page.findMany({ where: { bookId }, orderBy: [{ pageNumber: 'asc' }, { createdAt: 'asc' }] });
  }

  /**
   * Checks the monthly budget and the user's daily limit, then stores the
   * photo and the page, then queues detection. The caller has already checked
   * that `jpeg` is a JPEG. If the queue is down the page is still saved: it
   * waits in UPLOADED until the stuck-page check queues it.
   */
  async createPage(userId: string, bookId: string, pageNumber: number, jpeg: Buffer): Promise<Page> {
    await this.getBook(userId, bookId);
    const now = new Date();
    await this.usage.admitPage(userId, now);

    const id = randomUUID();
    const photoKey = pagePhotoKey(userId, id);
    let page: Page;
    try {
      await this.photos.put(photoKey, jpeg);
      page = await this.prisma.page.create({ data: { id, bookId, pageNumber, photoKey, createdAt: now, statusChangedAt: now, usageCountedAt: now } });
    } catch (error) {
      await this.photos.delete(photoKey).catch(() => undefined);
      await this.usage.release(userId, now);
      throw error;
    }
    await this.queue.enqueueDetection(page.id).catch((error: unknown) => {
      this.logger.warn(`Page ${page.id} saved but not queued; the stuck-page check will queue it: ${String(error)}`);
    });
    return page;
  }

  async getPage(userId: string, pageId: string): Promise<Page> {
    const page = UUID.test(pageId) ? await this.prisma.page.findFirst({ where: { id: pageId, book: { userId } } }) : null;
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  async getPagePhoto(userId: string, pageId: string): Promise<Buffer> {
    const page = await this.getPage(userId, pageId);
    if (page.photoDeletedAt) throw new NotFoundException('This photo has been deleted');
    try {
      return await this.photos.get(page.photoKey);
    } catch (error) {
      if (error instanceof PhotoNotFoundError) throw new NotFoundException('Photo not found');
      throw error;
    }
  }

  /**
   * Deletes the page's photo now instead of after 30 days. The marks, results
   * and word bank stay. Storage goes first, so a failure can be retried.
   */
  async deletePagePhoto(userId: string, pageId: string): Promise<void> {
    const page = await this.getPage(userId, pageId);
    if (page.photoDeletedAt) return;
    if (page.status === 'UPLOADED' || page.status === 'DETECTING') {
      throw new ConflictException('The marks on this photo are still being read. Delete it once they are ready.');
    }
    await this.photos.delete(page.photoKey);
    await this.prisma.page.update({ where: { id: pageId }, data: { photoDeletedAt: new Date() } });
  }
}
