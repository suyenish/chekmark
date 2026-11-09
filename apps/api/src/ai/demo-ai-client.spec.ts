import { detectionResultSchema } from '../detection/detection.schema.js';
import { explanationUserPrompt, resolveUserPrompt } from '../explanation/explanation.prompt.js';
import { explanationOutputSchema, resolveOutputSchema } from '../explanation/explanation.schema.js';
import { DEMO_MARKS, DemoAiClient } from './demo-ai-client.js';

const client = (onUsage = vi.fn()) => new DemoAiClient({ nodeEnv: 'development', onUsage });

describe('DemoAiClient (AI_PROVIDER=fake)', () => {
  it('refuses to start in production', () => {
    expect(() => new DemoAiClient({ nodeEnv: 'production' })).toThrow(/production/);
  });

  it('detects the same four marks on every page, including one unclear mark', async () => {
    const result = await client().generate({ purpose: 'detect', system: '', prompt: '', schema: detectionResultSchema, imageJpeg: Buffer.from([1]) });
    expect(result.photo_usable).toBe(true);
    expect(result.marks.map((m) => m.type)).toEqual(['underline_save', 'unclear', 'underline_translate', 'curly']);
    expect(result.marks).toEqual(DEMO_MARKS);
  });

  it('resolves each asked mark to its own text', async () => {
    const prompt = resolveUserPrompt([{ mark_id: 'm1', kind: 'word', text: '평평' }]);
    const result = await client().generate({ purpose: 'resolve', system: '', prompt, schema: resolveOutputSchema(['m1']) });
    expect(result).toEqual({ marks: [{ mark_id: 'm1', normal_form: '평평', sentence: null }] });
  });

  it('explains each mark, and matches an existing sense when one is given', async () => {
    const marks = [
      { mark_id: 'm1', kind: 'translation' as const, text: '너무나 기뻤다.', dictionary_form: null, sentence: '너무나 기뻤다.', existing_senses: [] },
      { mark_id: 'm2', kind: 'word' as const, text: '가까스로', dictionary_form: '가까스로', sentence: 's', existing_senses: [{ sense_id: 'sense-1', meaning: 'barely' }] },
      { mark_id: 'm3', kind: 'grammar' as const, text: '비록', dictionary_form: '비록 -지만', sentence: 's', existing_senses: [] },
    ];
    const schema = explanationOutputSchema([
      { markId: 'm1', kind: 'translation', senseIds: [] },
      { markId: 'm2', kind: 'word', senseIds: ['sense-1'] },
      { markId: 'm3', kind: 'grammar', senseIds: [] },
    ]);
    const onUsage = vi.fn();
    const result = await client(onUsage).generate({ purpose: 'explain', system: '', prompt: explanationUserPrompt(marks), schema, userId: 'u1', pageId: 'p1' });
    expect(result.results.map((r) => [r.mark_id, r.kind])).toEqual([
      ['m1', 'translation'],
      ['m2', 'existing'],
      ['m3', 'new'],
    ]);
    expect(result.results[1].sense_id).toBe('sense-1');
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'explain', model: 'fake', userId: 'u1', pageId: 'p1' }));
  });
});
