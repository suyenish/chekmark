import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { explanationOutputSchema, resolveOutputSchema } from './explanation.schema.js';

describe('explanation schemas', () => {
  it('can be sent to the API as JSON schemas', () => {
    const explain = zodOutputFormat(explanationOutputSchema([{ markId: 'm1', kind: 'word', senseIds: [] }]));
    expect(Object.keys((explain.schema as { properties: object }).properties)).toEqual(['results']);
    expect(() => zodOutputFormat(resolveOutputSchema(['m1']))).not.toThrow();
  });

  it('rejects a word explained without an example', () => {
    const schema = explanationOutputSchema([{ markId: 'm1', kind: 'word', senseIds: [] }]);
    const result = schema.safeParse({
      results: [
        { mark_id: 'm1', kind: 'new', translation: null, sense_id: null, meaning: 'barely', notes: 'n', example: ' ', example_translation: 't', sentence_translation: 's' },
      ],
    });
    expect(result.success).toBe(false);
  });
});
