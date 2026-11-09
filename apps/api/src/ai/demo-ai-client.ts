import type { DetectedMark } from '../detection/detection.schema.js';
import type { ExplainPromptMark } from '../explanation/explanation.prompt.js';
import type { AiClient, AiRequest, UsageListener } from './ai-client.js';

/**
 * The marks the fake AI "finds" on every page. One is unclear, so the Mark
 * check has something to resolve; the first word repeats on every page, so a
 * second page shows "You saw this on page …".
 */
export const DEMO_MARKS: DetectedMark[] = [
  { type: 'underline_save', text: '가까스로', normal_form: '가까스로', sentence: '그는 가까스로 시간에 맞췄다.', box: null },
  { type: 'unclear', text: '평평', normal_form: null, sentence: '눈물이 평평 쏟아졌다.', box: null },
  { type: 'underline_translate', text: '너무나 기뻤다.', normal_form: null, sentence: '마침내 표를 구했고 너무나 기뻤다.', box: null },
  { type: 'curly', text: '비록', normal_form: '비록 -지만', sentence: '비록 힘들었지만 끝까지 했다.', box: null },
];

/** The JSON list that the resolve and explain prompts carry after their first line. */
function marksIn<T>(prompt: string): T[] {
  return JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)) as T[];
}

/**
 * AI_PROVIDER=fake: answers every call from the request itself, without
 * calling Claude. Used for the end-to-end test and for trying the app
 * without an API key. Refuses to start in production.
 */
export class DemoAiClient implements AiClient {
  private readonly onUsage?: UsageListener;

  constructor(options: { nodeEnv: string; onUsage?: UsageListener }) {
    if (options.nodeEnv === 'production') throw new Error('AI_PROVIDER=fake must not be used in production');
    this.onUsage = options.onUsage;
  }

  async generate<T>(req: AiRequest<T>): Promise<T> {
    const output = this.answer(req);
    await this.onUsage?.({ purpose: req.purpose, model: 'fake', inputTokens: 1000, outputTokens: 200, durationMs: 0, userId: req.userId, pageId: req.pageId });
    return req.schema.parse(output);
  }

  private answer(req: AiRequest<unknown>): unknown {
    if (req.purpose === 'detect') return { photo_usable: true, problem: null, marks: DEMO_MARKS };

    if (req.purpose === 'resolve') {
      const marks = marksIn<{ mark_id: string; text: string }>(req.prompt);
      return { marks: marks.map((mark) => ({ mark_id: mark.mark_id, normal_form: mark.text, sentence: null })) };
    }

    const marks = marksIn<ExplainPromptMark>(req.prompt);
    const blank = { translation: null, sense_id: null, meaning: null, notes: null, example: null, example_translation: null, sentence_translation: null };
    return {
      results: marks.map((mark) => {
        if (mark.kind === 'translation') return { ...blank, mark_id: mark.mark_id, kind: 'translation', translation: `Practice translation of ${mark.text}` };
        const sentenceTranslation = `Practice translation of the sentence with ${mark.text}.`;
        const existing = mark.existing_senses[0];
        if (existing) return { ...blank, mark_id: mark.mark_id, kind: 'existing', sense_id: existing.sense_id, sentence_translation: sentenceTranslation };
        return {
          ...blank,
          mark_id: mark.mark_id,
          kind: 'new',
          meaning: `practice meaning of ${mark.dictionary_form ?? mark.text}`,
          notes: 'A practice note from the fake AI.',
          example: `${mark.dictionary_form ?? mark.text} 예문이에요.`,
          example_translation: 'This is a practice example.',
          sentence_translation: sentenceTranslation,
        };
      }),
    };
  }
}
