/** The longest edge of an uploaded photo. Enough to read small print, and well under the 10 MB limit. */
export const MAX_EDGE = 2000;
export const JPEG_QUALITY = 0.85;

export class PhotoReadError extends Error {
  constructor(cause?: unknown) {
    super('We could not read this file as a photo. Choose a photo of the page, or take a new one.', { cause });
    this.name = 'PhotoReadError';
  }
}

/** The two browser steps, kept apart so tests can stand in for them. */
export interface PhotoCodec {
  decode(file: File): Promise<{ width: number; height: number; source: CanvasImageSource; close?: () => void }>;
  encode(source: CanvasImageSource, width: number, height: number, quality: number): Promise<Blob>;
}

export const browserCodec: PhotoCodec = {
  async decode(file) {
    // Applies the camera's rotation, so a portrait photo stays upright.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
  },
  encode(source, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return Promise.reject(new Error('Canvas is not available'));
    context.drawImage(source, 0, 0, width, height);
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not make a JPEG'))), 'image/jpeg', quality),
    );
  },
};

/**
 * Turns any photo the browser can open (JPEG, PNG, HEIC on iPhone) into a
 * JPEG whose longest edge is at most 2000 px. Small photos are not enlarged.
 * The server only accepts JPEG, and smaller files upload faster on a phone.
 */
export async function preparePhoto(file: File, codec: PhotoCodec = browserCodec): Promise<Blob> {
  let image: Awaited<ReturnType<PhotoCodec['decode']>>;
  try {
    image = await codec.decode(file);
  } catch (error) {
    throw new PhotoReadError(error);
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);
    return await codec.encode(image.source, width, height, JPEG_QUALITY);
  } catch (error) {
    throw new PhotoReadError(error);
  } finally {
    image.close?.();
  }
}
