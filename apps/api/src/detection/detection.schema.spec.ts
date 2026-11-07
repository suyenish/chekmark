import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { detectionResultSchema, dropInvalidBoxes } from './detection.schema.js';

const mark = (overrides: Record<string, unknown> = {}) => ({
  type: 'underline_save',
  text: '사과를',
  normal_form: '사과',
  sentence: '사과를 먹었다.',
  box: [10, 20, 30, 40],
  ...overrides,
});
const result = (marks: unknown[], overrides: Record<string, unknown> = {}) => ({
  photo_usable: true,
  problem: null,
  marks,
  ...overrides,
});

describe('detectionResultSchema', () => {
  it.each(['underline_save', 'curly'])('accepts a %s mark with a normal form', (type) => {
    expect(detectionResultSchema.safeParse(result([mark({ type })])).success).toBe(true);
  });

  it('accepts an underline_translate mark with a null normal form', () => {
    const translate = mark({ type: 'underline_translate', normal_form: null });
    expect(detectionResultSchema.safeParse(result([translate])).success).toBe(true);
  });

  it('accepts an unclear mark with or without a normal form', () => {
    for (const normal_form of [null, '사과']) {
      const unclear = mark({ type: 'unclear', normal_form });
      expect(detectionResultSchema.safeParse(result([unclear])).success).toBe(true);
    }
  });

  it.each(['wavy', 'double', 'single'])('rejects the %s mark type', (type) => {
    expect(detectionResultSchema.safeParse(result([mark({ type })])).success).toBe(false);
  });

  it('requires problem text when photo_usable is false', () => {
    const missing = result([], { photo_usable: false, problem: null });
    const present = result([], { photo_usable: false, problem: 'Too dark to read' });
    expect(detectionResultSchema.safeParse(missing).success).toBe(false);
    expect(detectionResultSchema.safeParse(present).success).toBe(true);
  });

  it.each(['underline_save', 'curly'])('requires normal_form on a %s mark', (type) => {
    for (const normal_form of [null, '   ']) {
      const invalid = mark({ type, normal_form });
      expect(detectionResultSchema.safeParse(result([invalid])).success).toBe(false);
    }
  });

  it('requires a null normal_form on an underline_translate mark', () => {
    const invalid = mark({ type: 'underline_translate', normal_form: '사과' });
    expect(detectionResultSchema.safeParse(result([invalid])).success).toBe(false);
  });

  it('accepts a null box', () => {
    expect(detectionResultSchema.safeParse(result([mark({ box: null })])).success).toBe(true);
  });

  it.each([
    ['three values', [1, 2, 3]],
    ['a value above 1000', [0, 0, 1001, 10]],
    ['a negative value', [-1, 0, 10, 10]],
    ['left past right', [50, 0, 10, 10]],
    ['top past bottom', [0, 50, 10, 10]],
  ])('keeps the mark but drops a box with %s, because the box only draws the report', (_name, box) => {
    const parsed = detectionResultSchema.parse(result([mark({ box })]));
    expect(dropInvalidBoxes(parsed).marks[0]).toMatchObject({ text: '사과를', box: null });
  });

  it('keeps a valid box', () => {
    expect(dropInvalidBoxes(detectionResultSchema.parse(result([mark()]))).marks[0].box).toEqual([10, 20, 30, 40]);
  });

  it('can still be sent to the API as a JSON schema', () => {
    expect(() => zodOutputFormat(detectionResultSchema)).not.toThrow();
  });
});
