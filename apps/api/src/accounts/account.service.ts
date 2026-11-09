import { Inject, Injectable, Logger } from '@nestjs/common';
import { PHOTO_STORE, type PhotoStore } from '../photos/photo-store.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Deletes a reader's account and everything in it. */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PHOTO_STORE) private readonly photos: PhotoStore,
  ) {}

  /**
   * Photos go first: if one cannot be deleted, nothing else is, and the reader
   * can try again, rather than ending with a photo that no account points to.
   * Then the user row goes, and the database removes books, pages, marks, the
   * word bank, cards, sessions and AI call records with it. Unused sign-in
   * links, which are kept by email, are removed too.
   */
  async deleteAccount(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const pages = await this.prisma.page.findMany({
      where: { book: { userId }, photoDeletedAt: null },
      select: { photoKey: true },
    });
    for (const page of pages) await this.photos.delete(page.photoKey);

    await this.prisma.$transaction([
      this.prisma.loginToken.deleteMany({ where: { email: user.email } }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);
    this.logger.log(`Deleted account ${userId} with ${pages.length} photo(s)`);
  }
}
