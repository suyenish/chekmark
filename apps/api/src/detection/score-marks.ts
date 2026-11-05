import type { MarkType } from './detection.schema.js';

export const PASS_OVERALL = 0.9;
export const PASS_PER_TYPE = 0.8;

export interface ScoredMark {
  type: MarkType;
  text: string;
}
export interface ExpectedPage {
  file: string;
  marks: ScoredMark[];
}
export type ActualPage = ExpectedPage;

type ScoredType = 'double' | 'curly' | 'single';
const SCORED_TYPES: ScoredType[] = ['double', 'curly', 'single'];

export interface MarkScore {
  overall: number;
  /** Accuracy per mark type, or null when the answers contain none of that type. */
  byType: Record<ScoredType, number | null>;
  correct: number;
  expected: number;
  /** Detected marks that do not match any expected mark. */
  extra: number;
  passed: boolean;
}

const normalise = (text: string) => text.normalize('NFC').replace(/\s+/gu, '');

export function scoreMarks(expected: ExpectedPage[], actual: ActualPage[]): MarkScore {
  const totals = { double: 0, curly: 0, single: 0 };
  const hits = { double: 0, curly: 0, single: 0 };
  let extra = 0;

  const expectedFiles = new Set(expected.map((page) => page.file));
  for (const page of actual) {
    if (!expectedFiles.has(page.file)) extra += page.marks.length;
  }

  for (const page of expected) {
    const remaining = [...(actual.find((p) => p.file === page.file)?.marks ?? [])];
    const unresolved: ScoredMark[] = [];

    // Exact matches first, so the same text marked twice pairs up by type.
    for (const mark of page.marks) {
      const type = mark.type as ScoredType;
      totals[type] += 1;
      const index = remaining.findIndex((m) => m.type === mark.type && normalise(m.text) === normalise(mark.text));
      if (index === -1) {
        unresolved.push(mark);
      } else {
        hits[type] += 1;
        remaining.splice(index, 1);
      }
    }
    // A wrong-type mark with the right text is a miss, not an extra mark.
    for (const mark of unresolved) {
      const index = remaining.findIndex((m) => normalise(m.text) === normalise(mark.text));
      if (index !== -1) remaining.splice(index, 1);
    }
    extra += remaining.length;
  }

  const correct = hits.double + hits.curly + hits.single;
  const totalExpected = totals.double + totals.curly + totals.single;
  const denominator = totalExpected + extra;
  const overall = denominator === 0 ? 0 : correct / denominator;

  const byType = Object.fromEntries(
    SCORED_TYPES.map((type) => [type, totals[type] === 0 ? null : hits[type] / totals[type]]),
  ) as Record<ScoredType, number | null>;

  const passed =
    totalExpected > 0 &&
    overall >= PASS_OVERALL &&
    SCORED_TYPES.every((type) => byType[type] === null || (byType[type] as number) >= PASS_PER_TYPE);

  return { overall, byType, correct, expected: totalExpected, extra, passed };
}
