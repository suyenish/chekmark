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
  createdAt: page.createdAt,
});
