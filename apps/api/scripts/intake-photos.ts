// Prepares photos from volunteers for the mark test. Put each person's photos in their own folder:
//   private-test-data/inbox/<person>/<any file name>
// Usage:
//   pnpm --filter api intake                 take in anything new (safe to run again)
//   pnpm --filter api intake --hold-back 10  also keep 10 pages aside for the fair check
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { classifySource, emptyManifest, parseManifest, pickHoldBack, planIntake, type SourcePhoto } from '../src/detection/photo-intake.js';
import { convertPhoto } from './convert-photo.js';

const DATA_DIR = path.resolve(process.cwd(), '../../private-test-data');
const INBOX_DIR = path.join(DATA_DIR, 'inbox');
const HELD_BACK_DIR = path.join(DATA_DIR, 'held-back');
const MANIFEST_PATH = path.join(DATA_DIR, 'intake.json');

const { values: args } = parseArgs({ options: { 'hold-back': { type: 'string' } } });

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function printList(title: string, lines: string[]): void {
  if (lines.length === 0) return;
  console.log(`\n${title}:`);
  for (const line of lines) console.log(`  ${line}`);
}

async function main(): Promise<void> {
  const holdBack = args['hold-back'] === undefined ? null : Number(args['hold-back']);
  if (holdBack !== null && (!Number.isInteger(holdBack) || holdBack < 1)) fail('--hold-back needs a whole number, such as 10.');
  if (!existsSync(INBOX_DIR)) fail(`Put each person's photos in their own folder inside ${INBOX_DIR} first.`);

  const sources: SourcePhoto[] = [];
  const loose: string[] = [];
  const unsupported: string[] = [];
  for (const file of readdirSync(INBOX_DIR, { recursive: true, encoding: 'utf8' })) {
    const fullPath = path.join(INBOX_DIR, file);
    if (!statSync(fullPath).isFile()) continue;
    const found = classifySource(file);
    if (found.kind === 'loose') loose.push(file);
    if (found.kind === 'unsupported') unsupported.push(file);
    if (found.kind === 'photo') {
      sources.push({ person: found.person, source: file, hash: createHash('sha256').update(readFileSync(fullPath)).digest('hex') });
    }
  }

  const previous = existsSync(MANIFEST_PATH) ? parseManifest(readFileSync(MANIFEST_PATH, 'utf8')) : emptyManifest();
  const { manifest, toConvert, duplicates } = planIntake(previous, sources);

  const failed: string[] = [];
  for (const page of toConvert) {
    console.log(`${page.source} -> ${page.output}`);
    try {
      await convertPhoto(path.join(INBOX_DIR, page.source), path.join(DATA_DIR, page.output));
    } catch (error) {
      failed.push(`${page.source}: ${(error as Error).message.split('\n')[0]}`);
      manifest.pages = manifest.pages.filter((other) => other !== page);
    }
  }
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  if (holdBack !== null) {
    mkdirSync(HELD_BACK_DIR, { recursive: true });
    for (const page of pickHoldBack(manifest, holdBack)) {
      renameSync(path.join(DATA_DIR, page.output), path.join(HELD_BACK_DIR, page.output));
      page.heldBack = true;
      console.log(`Held back ${page.output}`);
    }
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  printList('Exact duplicates, not added', duplicates.map(({ source, sameAs }) => `${source} (same as ${sameAs})`));
  printList('Could not read, not added', failed);
  printList('Not in a person folder, not added', loose);
  printList('Not a photo type I can read, not added', unsupported);

  const held = manifest.pages.filter((page) => page.heldBack).length;
  const perPerson = Object.values(manifest.people).map((label) => `${label}: ${manifest.pages.filter((page) => page.person === label).length}`);
  printList('Pages per person', perPerson);
  console.log(`\nTotal: ${manifest.pages.length} pages, ${manifest.pages.length - held} ready for the mark test, ${held} held back.`);
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
