import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { convertPhoto } from './convert-photo.js';

const page = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#eeeeee' } });

describe('convertPhoto', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'convert-photo-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes location data from the copy', async () => {
    const input = path.join(dir, 'in.jpg');
    await page(40, 30)
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '37/1 33/1 0/1' } })
      .jpeg()
      .toFile(input);
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const output = path.join(dir, 'out.jpg');
    await convertPhoto(input, output);

    expect((await sharp(output).metadata()).exif).toBeUndefined();
  });

  it('turns the page the way the phone held it', async () => {
    const input = path.join(dir, 'in.jpg');
    await page(40, 30).withMetadata({ orientation: 6 }).jpeg().toFile(input);

    const output = path.join(dir, 'out.jpg');
    await convertPhoto(input, output);

    const { width, height, orientation } = await sharp(output).metadata();
    expect([width, height]).toEqual([30, 40]);
    expect(orientation).toBeUndefined();
  });

  it('saves a PNG as a JPEG', async () => {
    const input = path.join(dir, 'in.png');
    await page(40, 30).png().toFile(input);

    const output = path.join(dir, 'out.jpg');
    await convertPhoto(input, output);

    expect((await sharp(output).metadata()).format).toBe('jpeg');
  });

  it('keeps the full size, because the mark test does its own resizing', async () => {
    const input = path.join(dir, 'in.jpg');
    await page(3000, 4000).jpeg().toFile(input);

    const output = path.join(dir, 'out.jpg');
    await convertPhoto(input, output);

    const { width, height } = await sharp(output).metadata();
    expect([width, height]).toEqual([3000, 4000]);
  });

  it('fails on a damaged file and leaves no copy behind', async () => {
    const input = path.join(dir, 'in.jpg');
    writeFileSync(input, 'not a photo');

    const output = path.join(dir, 'out.jpg');
    await expect(convertPhoto(input, output)).rejects.toThrow();

    expect(existsSync(output)).toBe(false);
  });

  it.runIf(process.platform === 'darwin')('reads an iPhone HEIC photo and cleans up after itself', async () => {
    const jpeg = path.join(dir, 'source.jpg');
    await page(64, 48).jpeg().toFile(jpeg);
    const input = path.join(dir, 'in.HEIC');
    execFileSync('sips', ['-s', 'format', 'heic', jpeg, '--out', input], { stdio: 'ignore' });
    rmSync(jpeg);

    const output = path.join(dir, 'out.jpg');
    await convertPhoto(input, output);

    expect((await sharp(output).metadata()).format).toBe('jpeg');
    expect(readdirSync(dir).sort()).toEqual(['in.HEIC', 'out.jpg']);
  });
});
