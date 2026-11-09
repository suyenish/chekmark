import type { Page } from '../generated/prisma/client.js';

/** What the web app sees of a page. The storage key and raw model output stay on the server. */
export const pageView = (page: Page) => ({
  id: page.id,
  bookId: page.bookId,
  pageNumber: page.pageNumber,
  status: page.status,
  failedStage: page.failedStage,
  failureReason: page.failureReason,
  hasPhoto: page.photoDeletedAt === null,
  /** Detection said the photo cannot be read (blurry, dark, cut off): ask for a new photo, not a retry. */
  photoUnusable:
    page.status === 'FAILED' &&
    page.failedStage === 'DETECTING' &&
    (page.detectionResult as { photo_usable?: boolean } | null)?.photo_usable === false,
  createdAt: page.createdAt,
});
