import { z } from 'zod';
import type { ExplainResult } from '../wordbank/save-results.js';

/** What the model is asked about one mark. */
export type MarkKind = 'word' | 'grammar' | 'translation';

export interface MarkToExplain {
  markId: string;
  kind: MarkKind;
  /** IDs of the reader's existing senses for this mark's dictionary form. */
  senseIds: string[];
}

export interface RawExplainResult {
  mark_id: string;
  kind: 'translation' | 'existing' | 'new';
  translation: string | null;
  sense_id: string | null;
  meaning: string | null;
  notes: string | null;
  example: string | null;
  example_translation: string | null;
  sentence_translation: string | null;
}

const filled = (value: string | null): value is string => (value ?? '').trim() !== '';

// Every field is present and nullable, so the JSON schema sent to the API stays flat and simple.
const rawResult = z.object({
  mark_id: z.string(),
  kind: z.enum(['translation', 'existing', 'new']),
  translation: z.string().nullable(),
  sense_id: z.string().nullable(),
  meaning: z.string().nullable(),
  notes: z.string().nullable(),
  example: z.string().nullable(),
  example_translation: z.string().nullable(),
  sentence_translation: z.string().nullable(),
});

/**
 * The explain output, checked against this page's marks: one result per mark,
 * the right kind for each mark, and only sense IDs the reader really has for
 * that word. A failed check is invalid output, so the client retries once
 * with the reason.
 */
export function explanationOutputSchema(marks: MarkToExplain[]): z.ZodType<{ results: RawExplainResult[] }> {
  const byId = new Map(marks.map((mark) => [mark.markId, mark]));
  return z.object({ results: z.array(rawResult) }).superRefine((output, ctx) => {
    const seen = new Set<string>();
    output.results.forEach((result, index) => {
      const issue = (message: string) => ctx.addIssue({ code: 'custom', path: ['results', index], message });
      const mark = byId.get(result.mark_id);
      if (!mark) return issue(`Unknown mark_id ${result.mark_id}`);
      if (seen.has(result.mark_id)) return issue(`Mark ${result.mark_id} has more than one result`);
      seen.add(result.mark_id);

      if (mark.kind === 'translation') {
        if (result.kind !== 'translation') return issue(`Mark ${result.mark_id} is a sentence to translate: kind must be translation`);
        if (!filled(result.translation)) return issue(`Mark ${result.mark_id} needs a translation`);
        return;
      }
      if (result.kind === 'translation') return issue(`Mark ${result.mark_id} is a ${mark.kind}: kind must be existing or new`);
      if (!filled(result.sentence_translation)) return issue(`Mark ${result.mark_id} needs a sentence_translation`);
      if (result.kind === 'existing') {
        if (!result.sense_id || !mark.senseIds.includes(result.sense_id)) {
          return issue(`Mark ${result.mark_id}: sense_id must be one of the existing senses given for it`);
        }
        return;
      }
      for (const field of ['meaning', 'notes', 'example', 'example_translation'] as const) {
        if (!filled(result[field])) issue(`Mark ${result.mark_id} needs ${field}`);
      }
    });
    for (const mark of marks) {
      if (!seen.has(mark.markId)) ctx.addIssue({ code: 'custom', path: ['results'], message: `Missing a result for mark ${mark.markId}` });
    }
  }) as unknown as z.ZodType<{ results: RawExplainResult[] }>;
}

/** Turns checked output into the shape saveResults takes. */
export function toExplainResults(raw: RawExplainResult[]): ExplainResult[] {
  return raw.map((r): ExplainResult => {
    if (r.kind === 'translation') return { markId: r.mark_id, kind: 'translation', translation: r.translation!.trim() };
    if (r.kind === 'existing') return { markId: r.mark_id, kind: 'existing', senseId: r.sense_id!, sentenceTranslation: r.sentence_translation!.trim() };
    return {
      markId: r.mark_id,
      kind: 'new',
      meaning: r.meaning!.trim(),
      notes: r.notes!.trim(),
      example: r.example!.trim(),
      exampleTranslation: r.example_translation!.trim(),
      sentenceTranslation: r.sentence_translation!.trim(),
    };
  });
}

export interface RawResolved {
  mark_id: string;
  normal_form: string;
  sentence: string | null;
}

/** The resolve output: a dictionary form (and the sentence, if found) for exactly the marks asked about. */
export function resolveOutputSchema(markIds: string[]): z.ZodType<{ marks: RawResolved[] }> {
  const wanted = new Set(markIds);
  return z
    .object({ marks: z.array(z.object({ mark_id: z.string(), normal_form: z.string(), sentence: z.string().nullable() })) })
    .superRefine((output, ctx) => {
      const seen = new Set<string>();
      output.marks.forEach((mark, index) => {
        if (!wanted.has(mark.mark_id)) ctx.addIssue({ code: 'custom', path: ['marks', index], message: `Unknown mark_id ${mark.mark_id}` });
        else if (seen.has(mark.mark_id)) ctx.addIssue({ code: 'custom', path: ['marks', index], message: `Mark ${mark.mark_id} appears twice` });
        else if (!filled(mark.normal_form)) ctx.addIssue({ code: 'custom', path: ['marks', index], message: `Mark ${mark.mark_id} needs a normal_form` });
        seen.add(mark.mark_id);
      });
      for (const id of wanted) {
        if (!seen.has(id)) ctx.addIssue({ code: 'custom', path: ['marks'], message: `Missing mark ${id}` });
      }
    }) as unknown as z.ZodType<{ marks: RawResolved[] }>;
}
