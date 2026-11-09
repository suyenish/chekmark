import type { Page } from '../generated/prisma/client.js';
import { pageView } from './views.js';

const page = (overrides: Partial<Page>): Page =>
  ({
    id: 'p1',
    bookId: 'b1',
    pageNumber: 3,
    photoKey: 'users/u/pages/p1.jpg',
    status: 'FAILED',
    statusChangedAt: new Date(),
    failedStage: 'DETECTING',
    failureReason: 'The photo is too dark.',
    detectionResult: { photo_usable: false, problem: 'The photo is too dark.', marks: [] },
    photoDeletedAt: null,
    createdAt: new Date(),
    ...overrides,
  }) as Page;

describe('pageView', () => {
  it('says the photo was unusable when detection said so, so the app asks for a retake', () => {
    expect(pageView(page({})).photoUnusable).toBe(true);
  });

  it('does not call other failures unusable', () => {
    expect(pageView(page({ detectionResult: null, failureReason: 'Please try again.' })).photoUnusable).toBe(false);
    expect(pageView(page({ failedStage: 'EXPLAINING', detectionResult: { photo_usable: true, problem: null, marks: [] } })).photoUnusable).toBe(false);
    expect(pageView(page({ status: 'DONE', failedStage: null, detectionResult: { photo_usable: true, problem: null, marks: [] } })).photoUnusable).toBe(false);
  });

  it('never sends the storage key or raw model output', () => {
    expect(pageView(page({}))).not.toHaveProperty('photoKey');
    expect(pageView(page({}))).not.toHaveProperty('detectionResult');
  });
});
