import { scoreMarks } from './score-marks.js';

const page = (marks: { type: 'underline_save' | 'underline_translate' | 'curly' | 'unclear'; text: string }[]) => ({
  file: 'a.jpg',
  marks,
});

describe('scoreMarks', () => {
  it('counts a mark correct only when text and type both match', () => {
    const s = scoreMarks(
      [page([{ type: 'underline_save', text: '사과' }, { type: 'curly', text: '-(으)ㄹ 뻔하다' }])],
      [page([{ type: 'underline_save', text: '사과' }, { type: 'underline_translate', text: '-(으)ㄹ 뻔하다' }])],
    );
    expect(s.overall).toBe(0.5);
    expect(s.byType.underline_save).toBe(1);
    expect(s.byType.curly).toBe(0);
  });

  it('ignores whitespace and Unicode form when comparing text', () => {
    const s = scoreMarks(
      [page([{ type: 'underline_save', text: '사과 나무' }])],
      [page([{ type: 'underline_save', text: '사과나무'.normalize('NFD') }])],
    );
    expect(s.overall).toBe(1);
  });

  it('counts an unclear label as incorrect', () => {
    const s = scoreMarks(
      [page([{ type: 'underline_save', text: '사과' }])],
      [page([{ type: 'unclear', text: '사과' }])],
    );
    expect(s.overall).toBe(0);
  });

  it('counts a mark that was not in the answers against overall accuracy', () => {
    const s = scoreMarks(
      [page([{ type: 'underline_save', text: '사과' }])],
      [page([{ type: 'underline_save', text: '사과' }, { type: 'underline_save', text: '배' }])],
    );
    expect(s.overall).toBe(0.5);
    expect(s.extra).toBe(1);
  });

  it('counts every expected mark as missed when a page has no result', () => {
    const s = scoreMarks([page([{ type: 'underline_save', text: '사과' }])], []);
    expect(s.overall).toBe(0);
    expect(s.byType.underline_save).toBe(0);
  });

  it('matches repeated text once each', () => {
    const s = scoreMarks(
      [page([{ type: 'underline_save', text: '사과' }, { type: 'underline_save', text: '사과' }])],
      [page([{ type: 'underline_save', text: '사과' }])],
    );
    expect(s.overall).toBe(0.5);
  });

  it('prefers the same type when the same text is marked twice', () => {
    const s = scoreMarks(
      [page([{ type: 'underline_translate', text: '사과' }, { type: 'underline_save', text: '사과' }])],
      [page([{ type: 'underline_save', text: '사과' }, { type: 'underline_translate', text: '사과' }])],
    );
    expect(s.overall).toBe(1);
  });

  it('passes only at overall >= 0.9 with every type >= 0.8', () => {
    const marks = (type: 'underline_save' | 'curly', n: number) =>
      Array.from({ length: n }, (_, i) => ({ type, text: `${type}${i}` }));

    const expected = [page([...marks('underline_save', 10), ...marks('curly', 10)])];
    const nineteen = [page([...marks('underline_save', 10), ...marks('curly', 9)])];
    expect(scoreMarks(expected, nineteen).passed).toBe(true);

    const eighteen = [page([...marks('underline_save', 9), ...marks('curly', 8)])];
    expect(scoreMarks(expected, eighteen).passed).toBe(false);

    const weakType = [page([...marks('underline_save', 40), ...marks('curly', 7)])];
    const manySaved = [page([...marks('underline_save', 40), ...marks('curly', 10)])];
    const s = scoreMarks(manySaved, weakType);
    expect(s.overall).toBeGreaterThanOrEqual(0.9);
    expect(s.byType.curly).toBe(0.7);
    expect(s.passed).toBe(false);
  });

  it('counts a right underline with the wrong save decision as incorrect', () => {
    const s = scoreMarks(
      [page([{ type: 'underline_translate', text: '갔어요.' }])],
      [page([{ type: 'underline_save', text: '갔어요.' }])],
    );
    expect(s.overall).toBe(0);
    expect(s.byType.underline_translate).toBe(0);
    expect(s.extra).toBe(0);
  });

  it('does not pass when there are no expected marks', () => {
    expect(scoreMarks([], []).passed).toBe(false);
  });

  it('returns null accuracy for a type with no expected marks', () => {
    const s = scoreMarks([page([{ type: 'underline_save', text: '사과' }])], [page([{ type: 'underline_save', text: '사과' }])]);
    expect(s.byType.underline_translate).toBeNull();
    expect(s.passed).toBe(true);
  });
});
