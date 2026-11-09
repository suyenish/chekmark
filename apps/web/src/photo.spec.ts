import { JPEG_QUALITY, MAX_EDGE, type PhotoCodec, PhotoReadError, preparePhoto } from './photo';

/** Stands in for the browser's image decoding and canvas, which jsdom does not have. */
function fakeCodec(width: number, height: number) {
  const encoded: { width: number; height: number; quality: number }[] = [];
  const codec: PhotoCodec = {
    decode: async () => ({ width, height, source: {} as CanvasImageSource, close: () => {} }),
    encode: async (_source, w, h, quality) => {
      encoded.push({ width: w, height: h, quality });
      return new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    },
  };
  return { codec, encoded };
}

const file = new File([new Uint8Array([1, 2, 3])], 'page.heic', { type: 'image/heic' });

describe('preparePhoto', () => {
  it('shrinks a large image to a 2000 px longest edge and outputs JPEG', async () => {
    const { codec, encoded } = fakeCodec(4284, 5712); // an iPhone photo, portrait
    const blob = await preparePhoto(file, codec);
    expect(encoded).toEqual([{ width: 1500, height: 2000, quality: 0.85 }]);
    expect(blob.type).toBe('image/jpeg');
    expect(MAX_EDGE).toBe(2000);
    expect(JPEG_QUALITY).toBe(0.85);
  });

  it('shrinks a landscape photo by its width', async () => {
    const { codec, encoded } = fakeCodec(4000, 3000);
    await preparePhoto(file, codec);
    expect(encoded[0]).toMatchObject({ width: 2000, height: 1500 });
  });

  it('does not enlarge a small image', async () => {
    const { codec, encoded } = fakeCodec(1200, 900);
    await preparePhoto(file, codec);
    expect(encoded[0]).toMatchObject({ width: 1200, height: 900 });
  });

  it('shows a clear error when the browser cannot read the file', async () => {
    const codec: PhotoCodec = {
      decode: async () => {
        throw new Error('The source image could not be decoded.');
      },
      encode: async () => new Blob(),
    };
    const promise = preparePhoto(new File(['not an image'], 'notes.txt', { type: 'text/plain' }), codec);
    await expect(promise).rejects.toBeInstanceOf(PhotoReadError);
    await expect(promise).rejects.toThrow(/could not read this file as a photo/i);
  });
});
