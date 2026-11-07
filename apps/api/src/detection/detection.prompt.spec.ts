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

describe('DETECTION_SYSTEM_PROMPT rules from the first mark test', () => {
  it('reports whole words when a line stops partway through one', () => {
    expect(DETECTION_SYSTEM_PROMPT).toMatch(/whole words/);
    expect(DETECTION_SYSTEM_PROMPT).toMatch(/more than half/);
  });

  it('follows each line to its end instead of stopping early', () => {
    expect(DETECTION_SYSTEM_PROMPT).toMatch(/to its very end/);
  });

  it('reports a line between two printed lines once, for the text above it', () => {
    expect(DETECTION_SYSTEM_PROMPT).toMatch(/between two printed lines/);
  });

  it('looks for faint pencil on grey or coloured boxes', () => {
    expect(DETECTION_SYSTEM_PROMPT).toMatch(/faint/);
  });
});
