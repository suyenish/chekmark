/** Where page photos are kept. Photos are private: only the API reads them. */
export interface PhotoStore {
  put(key: string, jpeg: Buffer): Promise<void>;
  /** Throws PhotoNotFoundError when there is no photo under the key. */
  get(key: string): Promise<Buffer>;
  /** Deleting a photo that is already gone is not an error. */
  delete(key: string): Promise<void>;
}

/** Nest injection token for the PhotoStore. */
export const PHOTO_STORE = Symbol('PHOTO_STORE');

export class PhotoNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`No photo stored under ${key}`);
    this.name = 'PhotoNotFoundError';
  }
}

/** Photos above this size are refused. The web app shrinks photos well below it. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Every JPEG file starts with these three bytes. */
export function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** One place that decides where a page's photo lives. */
export function pagePhotoKey(userId: string, pageId: string): string {
  return `users/${userId}/pages/${pageId}.jpg`;
}
