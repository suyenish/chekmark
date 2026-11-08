import type { PhotoStore } from '../../src/photos/photo-store.js';
import { PhotoNotFoundError } from '../../src/photos/photo-store.js';

/** Keeps photos in memory so API tests do not need object storage. */
export class MemoryPhotoStore implements PhotoStore {
  readonly photos = new Map<string, Buffer>();

  async put(key: string, jpeg: Buffer): Promise<void> {
    this.photos.set(key, Buffer.from(jpeg));
  }

  async get(key: string): Promise<Buffer> {
    const photo = this.photos.get(key);
    if (!photo) throw new PhotoNotFoundError(key);
    return photo;
  }

  async delete(key: string): Promise<void> {
    this.photos.delete(key);
  }
}
