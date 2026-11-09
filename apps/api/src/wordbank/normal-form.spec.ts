import { toNormalForm } from './normal-form.js';

describe('toNormalForm', () => {
  it('matches composed and decomposed Korean as the same normal form', () => {
    expect(toNormalForm('사과'.normalize('NFD'))).toBe(toNormalForm('사과'));
    expect(toNormalForm('사과'.normalize('NFD'))).toBe('사과');
  });

  it('collapses extra spaces in a grammar pattern', () => {
    expect(toNormalForm('  -(으)ㄹ   뻔하다 ')).toBe('-(으)ㄹ 뻔하다');
    expect(toNormalForm('-(으)ㄹ\t뻔\n하다')).toBe('-(으)ㄹ 뻔 하다');
  });
});
