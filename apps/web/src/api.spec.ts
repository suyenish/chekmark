import { ApiError, httpApi, SIGNED_OUT_EVENT } from './api';

const answer = (status: number, body: unknown = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('httpApi', () => {
  const signedOut = vi.fn();

  beforeEach(() => {
    signedOut.mockClear();
    window.addEventListener(SIGNED_OUT_EVENT, signedOut);
  });

  afterEach(() => {
    window.removeEventListener(SIGNED_OUT_EVENT, signedOut);
    vi.unstubAllGlobals();
  });

  it('tells the app when a request finds the session gone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(401, { message: 'Unauthorized' })));
    await expect(httpApi.listBooks()).rejects.toMatchObject({ status: 401, message: 'Your session has ended. Please sign in again.' });
    expect(signedOut).toHaveBeenCalledTimes(1);
  });

  it('does not treat "not signed in yet" or a bad sign-in link as a lost session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(401, { message: 'This sign-in link is invalid, used or expired. Ask for a new one.' })));
    await expect(httpApi.me()).resolves.toBeNull();
    await expect(httpApi.verify('old')).rejects.toBeInstanceOf(ApiError);
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('gives a plain message when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(httpApi.listBooks()).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/Could not reach Chekmark/) });
  });

  it('uses the server message for other errors, and a plain one when there is none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(429, { message: 'You have used today\'s 5 pages.' })));
    await expect(httpApi.listBooks()).rejects.toMatchObject({ status: 429, message: "You have used today's 5 pages." });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(httpApi.listBooks()).rejects.toMatchObject({ status: 502, message: 'Chekmark is restarting or cannot be reached. Please try again in a moment.' });
  });
});
