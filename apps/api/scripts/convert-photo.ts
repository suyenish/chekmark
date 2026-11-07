import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import sharp from 'sharp';

const run = promisify(execFile);
const JPEG_QUALITY = 92;

/**
 * Writes a JPEG working copy. sharp drops all metadata unless asked to keep it, which removes
 * location data. Prebuilt sharp cannot read HEIC, so those go through the Mac's sips first.
 */
export async function convertPhoto(input: string, output: string): Promise<void> {
  const isHeic = /\.(heic|heif)$/i.test(input);
  const readable = isHeic ? `${output}.from-heic.jpg` : input;
  try {
    if (isHeic) await run('sips', ['-s', 'format', 'jpeg', input, '--out', readable]);
    await sharp(readable).rotate().jpeg({ quality: JPEG_QUALITY }).toFile(output);
  } finally {
    if (isHeic) await rm(readable, { force: true });
  }
}
