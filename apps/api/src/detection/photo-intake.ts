import { z } from 'zod';

const pageSchema = z.object({
  hash: z.string(),
  source: z.string(),
  output: z.string(),
  person: z.string(),
  heldBack: z.boolean(),
});

const manifestSchema = z.object({
  /** Inbox folder name, which may be a real name, to the label used in file names. */
  people: z.record(z.string(), z.string()),
  pages: z.array(pageSchema),
});

export type IntakePage = z.infer<typeof pageSchema>;
export type IntakeManifest = z.infer<typeof manifestSchema>;

export const emptyManifest = (): IntakeManifest => ({ people: {}, pages: [] });

export function parseManifest(json: string): IntakeManifest {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new Error(`intake.json is not valid JSON: ${(error as Error).message}`);
  }
  const result = manifestSchema.safeParse(data);
  if (!result.success) throw new Error(`intake.json has a problem:\n${z.prettifyError(result.error)}`);
  return result.data;
}

export type SourceKind = { kind: 'photo'; person: string } | { kind: 'loose' } | { kind: 'unsupported' } | { kind: 'ignored' };

/** Sorts a path found inside the inbox. The first folder in the path is the person who sent it. */
export function classifySource(relativePath: string): SourceKind {
  const parts = relativePath.split(/[\\/]/);
  if (parts.some((part) => part.startsWith('.') || part === '__MACOSX')) return { kind: 'ignored' };
  if (!/\.(jpe?g|png|heic|heif|webp)$/i.test(relativePath)) return { kind: 'unsupported' };
  return parts.length === 1 ? { kind: 'loose' } : { kind: 'photo', person: parts[0] };
}

export interface SourcePhoto {
  person: string;
  /** Path inside the inbox. */
  source: string;
  /** Hash of the file's bytes, so identical files are recognised under any name. */
  hash: string;
}

export interface IntakePlan {
  manifest: IntakeManifest;
  toConvert: IntakePage[];
  duplicates: { source: string; sameAs: string }[];
}

function nextPageNumber(pages: IntakePage[], label: string): number {
  const used = pages.filter((page) => page.person === label).map((page) => Number(/-(\d+)\.jpg$/.exec(page.output)?.[1] ?? 0));
  return Math.max(0, ...used) + 1;
}

/** Works out what is new. Names already given never change, so earlier answers stay valid. */
export function planIntake(manifest: IntakeManifest, sources: SourcePhoto[]): IntakePlan {
  const people = { ...manifest.people };
  const pages = [...manifest.pages];
  const toConvert: IntakePage[] = [];
  const duplicates: IntakePlan['duplicates'] = [];

  for (const { person, source, hash } of [...sources].sort((a, b) => a.source.localeCompare(b.source))) {
    const existing = pages.find((page) => page.hash === hash);
    if (existing) {
      if (existing.source !== source) duplicates.push({ source, sameAs: existing.source });
      continue;
    }
    people[person] ??= `person${Object.keys(people).length + 1}`;
    const label = people[person];
    const number = String(nextPageNumber(pages, label)).padStart(2, '0');
    const page: IntakePage = { hash, source, output: `${label}-${number}.jpg`, person: label, heldBack: false };
    pages.push(page);
    toConvert.push(page);
  }
  return { manifest: { people, pages }, toConvert, duplicates };
}

/**
 * Chooses pages to keep out of prompt work, up to `total` held back overall. Takes from whoever has
 * the fewest held so far, so one person's handwriting does not fill the fair check. Hash order is
 * effectively random, but the same pages always give the same choice.
 */
export function pickHoldBack(manifest: IntakeManifest, total: number): IntakePage[] {
  if (total >= manifest.pages.length) {
    throw new Error(`Holding back ${total} needs at least ${total + 1} pages, and there are ${manifest.pages.length}.`);
  }
  const heldCount = new Map<string, number>();
  const available = new Map<string, IntakePage[]>();
  const pages = [...manifest.pages].sort((a, b) => a.hash.localeCompare(b.hash));
  for (const page of pages) {
    if (page.heldBack) heldCount.set(page.person, (heldCount.get(page.person) ?? 0) + 1);
    else available.set(page.person, [...(available.get(page.person) ?? []), page]);
  }

  const chosen: IntakePage[] = [];
  let held = pages.length - [...available.values()].flat().length;
  while (held < total) {
    const [person] = [...available.keys()]
      .filter((key) => available.get(key)!.length > 0)
      .sort((a, b) => (heldCount.get(a) ?? 0) - (heldCount.get(b) ?? 0) || a.localeCompare(b));
    chosen.push(available.get(person)!.shift()!);
    heldCount.set(person, (heldCount.get(person) ?? 0) + 1);
    held += 1;
  }
  return chosen;
}
