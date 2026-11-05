import { DETECTION_SYSTEM_PROMPT } from './detection.prompt.js';
import { MARK_TYPES } from './detection.schema.js';

describe('DETECTION_SYSTEM_PROMPT', () => {
  it.each(MARK_TYPES)('explains the %s type', (type) => {
    expect(DETECTION_SYSTEM_PROMPT).toContain(`"${type}"`);
  });

  it('no longer mentions double or single lines', () => {
    expect(DETECTION_SYSTEM_PROMPT).not.toMatch(/double|single:/i);
  });

  it('defines a whole-sentence underline, including a one-word sentence', () => {
    expect(DETECTION_SYSTEM_PROMPT).toMatch(/complete printed sentence/);
    expect(DETECTION_SYSTEM_PROMPT).toContain('갔어요.');
  });
});
