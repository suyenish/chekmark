import { readCookie } from './session.guard.js';

describe('readCookie', () => {
  it('finds one cookie among several', () => {
    expect(readCookie('theme=dark; session=abc; lang=ko', 'session')).toBe('abc');
  });

  it('keeps an = sign inside the value', () => {
    expect(readCookie('session=a=b', 'session')).toBe('a=b');
  });

  it('does not match a cookie whose name only ends the same way', () => {
    expect(readCookie('oldsession=abc', 'session')).toBeNull();
  });

  it('returns null without a Cookie header', () => {
    expect(readCookie(undefined, 'session')).toBeNull();
  });

  it('treats a cookie that cannot be decoded as no cookie, instead of crashing', () => {
    expect(readCookie('session=%E0%A4%A', 'session')).toBeNull();
  });
});
