import { calculateCost, parseAnswers, pickPhotos, renderReport } from './mark-test-lib.js';

describe('parseAnswers', () => {
  it('reads pages and marks', () => {
    const json = JSON.stringify([{ file: 'a.jpg', marks: [{ type: 'double', text: '사과' }] }]);
    expect(parseAnswers(json)).toEqual([{ file: 'a.jpg', marks: [{ type: 'double', text: '사과' }] }]);
  });

  it('rejects unclear in the answers, because every answer must be decided', () => {
    const json = JSON.stringify([{ file: 'a.jpg', marks: [{ type: 'unclear', text: '사과' }] }]);
    expect(() => parseAnswers(json)).toThrow(/double|curly|single/);
  });

  it('gives a clear error for invalid JSON', () => {
    expect(() => parseAnswers('{oops')).toThrow(/answers\.json/);
  });
});

describe('pickPhotos', () => {
  it('returns JPEG and PNG files in name order, ignoring other files', () => {
    const { photos } = pickPhotos(['b.JPG', 'a.jpeg', 'c.png', 'answers.json', 'report.html', '.DS_Store']);
    expect(photos).toEqual(['a.jpeg', 'b.JPG', 'c.png']);
  });

  it('lists HEIC files separately so they can be converted first', () => {
    expect(pickPhotos(['a.jpg', 'b.HEIC']).unsupported).toEqual(['b.HEIC']);
  });
});

describe('calculateCost', () => {
  it('uses prices per million tokens', () => {
    expect(calculateCost(1_000_000, 500_000, { input: 4, output: 20 })).toBe(14);
  });

  it('returns null without prices', () => {
    expect(calculateCost(100, 100, null)).toBeNull();
  });
});

describe('renderReport', () => {
  const score = {
    overall: 0.5,
    byType: { double: 1, curly: 0, single: null },
    correct: 1,
    expected: 2,
    extra: 0,
    passed: false,
  };
  const page = {
    file: 'a.jpg',
    expected: [{ type: 'double' as const, text: '사과' }],
    detected: [{ type: 'double' as const, text: '사과', normal_form: '사과', sentence: 's', box: [10, 20, 30, 40] as [number, number, number, number] }],
  };

  it('shows the score and the result', () => {
    const html = renderReport(score, [page], 'test-model');
    expect(html).toContain('50.0%');
    expect(html).toContain('FAIL');
    expect(html).toContain('test-model');
  });

  it('positions a box as a percentage of the photo', () => {
    const html = renderReport(score, [page], 'm');
    expect(html).toContain('left:1%');
    expect(html).toContain('top:2%');
    expect(html).toContain('width:2%');
    expect(html).toContain('height:2%');
  });

  it('escapes text read from the page', () => {
    const risky = { ...page, detected: [{ ...page.detected[0], text: '<script>x</script>' }] };
    const html = renderReport(score, [risky], 'm');
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;x');
  });

  it('shows the error for a page that failed', () => {
    const html = renderReport(score, [{ ...page, detected: [], error: 'Model refused' }], 'm');
    expect(html).toContain('Model refused');
  });
});
