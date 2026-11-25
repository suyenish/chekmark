import { createContext, useContext } from 'react';

export type PageStatus = 'UPLOADED' | 'DETECTING' | 'AWAITING_CHECK' | 'EXPLAINING' | 'DONE' | 'FAILED';
export type MarkType = 'underline_save' | 'underline_translate' | 'curly' | 'unclear';
export type ChosenMarkType = Exclude<MarkType, 'unclear'>;

export interface User {
  id: string;
  email: string;
  /** Only on temporary demo accounts. */
  demo?: true;
}

export interface Book {
  id: string;
  title: string;
  sourceLanguage: string;
  createdAt: string;
  pageCount?: number;
}

export interface PageInfo {
  id: string;
  bookId: string;
  pageNumber: number | null;
  status: PageStatus;
  failedStage: 'DETECTING' | 'EXPLAINING' | null;
  failureReason: string | null;
  hasPhoto: boolean;
  photoUnusable: boolean;
  createdAt: string;
}

export interface MarkInfo {
  id: string;
  order: number;
  type: MarkType;
  text: string;
  normalForm: string | null;
  sentence: string | null;
  source: 'detected' | 'corrected' | 'added';
  saved: boolean;
}

export type MarkEdit = { type: ChosenMarkType } | { save: boolean } | { text: string };

export interface SeenBefore {
  bookId: string;
  bookTitle: string;
  pageId: string;
  pageNumber: number | null;
  sentence: string;
}

export type PageResult =
  | { markId: string; kind: 'translation'; text: string; translation: string }
  | {
      markId: string;
      kind: 'word' | 'grammar';
      text: string;
      normalForm: string;
      itemId: string;
      senseId: string;
      meaning: string;
      notes: string | null;
      example: string | null;
      exampleTranslation: string | null;
      sentence: string;
      sentenceTranslation: string | null;
      seenBefore: SeenBefore[];
    };

export type ItemKind = 'word' | 'grammar';

export interface ItemSummary {
  id: string;
  kind: ItemKind;
  normalForm: string;
  meanings: string[];
  sightingCount: number;
  createdAt: string;
}

export interface Sighting {
  id: string;
  bookId: string;
  bookTitle: string;
  pageId: string;
  pageNumber: number | null;
  sentence: string;
  sentenceTranslation: string | null;
  createdAt: string;
}

export interface Sense {
  id: string;
  meaning: string;
  notes: string | null;
  example: string | null;
  exampleTranslation: string | null;
  sightings: Sighting[];
}

export interface ItemDetail {
  id: string;
  kind: ItemKind;
  normalForm: string;
  createdAt: string;
  senses: Sense[];
}

export type SenseEdit = { senseId: string; meaning?: string; notes?: string | null };

export type Rating = 'again' | 'hard' | 'easy';

export interface DueCard {
  cardId: string;
  kind: ItemKind;
  normalForm: string;
  front: { sentence: string; highlight: { text: string; start: number } | null };
  back: { meaning: string; notes: string | null; example: string | null; exampleTranslation: string | null; sentenceTranslation: string | null };
  source: { bookTitle: string; pageNumber: number | null } | null;
}

/** An answer from the server that was not a success. `message` is written for the reader. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Normally empty. On a developer's own machine with no email service, the
 * server returns the link (or says the address is not allowed) so the screen can show it.
 */
export interface RequestLinkAnswer {
  dev?: { link: string } | { notAllowed: true };
}

export interface Api {
  me(): Promise<User | null>;
  requestLink(email: string): Promise<RequestLinkAnswer>;
  verify(token: string): Promise<User>;
  /** Whether this server offers the demo. */
  demoEnabled(): Promise<boolean>;
  startDemo(): Promise<User>;
  logout(): Promise<void>;
  listBooks(): Promise<Book[]>;
  createBook(title: string): Promise<Book>;
  getBook(id: string): Promise<Book>;
  listPages(bookId: string): Promise<PageInfo[]>;
  uploadPage(bookId: string, pageNumber: number, photo: Blob): Promise<PageInfo>;
  getPage(id: string): Promise<PageInfo>;
  photoUrl(pageId: string): string;
  listMarks(pageId: string): Promise<MarkInfo[]>;
  editMark(markId: string, edit: MarkEdit): Promise<MarkInfo>;
  deleteMark(markId: string): Promise<void>;
  addMark(pageId: string, mark: { type: ChosenMarkType; text: string }): Promise<MarkInfo>;
  confirm(pageId: string): Promise<PageInfo>;
  retry(pageId: string): Promise<PageInfo>;
  pageResults(pageId: string): Promise<PageResult[]>;
  deletePagePhoto(pageId: string): Promise<void>;
  listItems(filter: { q?: string; kind?: ItemKind }): Promise<ItemSummary[]>;
  getItem(id: string): Promise<ItemDetail>;
  editSense(itemId: string, edit: SenseEdit): Promise<ItemDetail>;
  deleteItem(id: string): Promise<void>;
  dueCards(): Promise<DueCard[]>;
  rateCard(cardId: string, rating: Rating): Promise<{ cardId: string; dueAt: string; intervalDays: number; ease: number }>;
  deleteAccount(): Promise<void>;
}

const BASE = '/api';

/** Sent on `window` when a request finds the session gone, so the app can show the sign-in screen. */
export const SIGNED_OUT_EVENT = 'chekmark:signed-out';

/** Requests where 401 means "not signed in yet" or "bad link", not "your session ended". */
const NOT_A_LOST_SESSION = ['/me', '/auth/'];

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'include' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(0, 'Could not reach Chekmark. Check your connection and try again.');
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !NOT_A_LOST_SESSION.some((prefix) => path.startsWith(prefix))) {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
      throw new ApiError(401, 'Your session has ended. Please sign in again.', data);
    }
    const message = (data as { message?: unknown } | null)?.message;
    const fallback = response.status >= 502 ? 'Chekmark is restarting or cannot be reached. Please try again in a moment.' : 'Something went wrong. Please try again.';
    throw new ApiError(response.status, typeof message === 'string' ? message : fallback, data);
  }
  return data as T;
}

export const httpApi: Api = {
  async me() {
    try {
      return await call<User>('GET', '/me');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  requestLink: async (email) => (await call<RequestLinkAnswer | null>('POST', '/auth/request-link', { email })) ?? {},
  verify: (token) => call('POST', '/auth/verify', { token }),
  demoEnabled: async () => (await call<{ enabled: boolean }>('GET', '/demo')).enabled,
  startDemo: () => call('POST', '/demo'),
  logout: () => call('POST', '/auth/logout'),
  listBooks: () => call('GET', '/books'),
  createBook: (title) => call('POST', '/books', { title }),
  getBook: (id) => call('GET', `/books/${id}`),
  listPages: (bookId) => call('GET', `/books/${bookId}/pages`),
  uploadPage(bookId, pageNumber, photo) {
    const form = new FormData();
    form.append('pageNumber', String(pageNumber));
    form.append('photo', photo, 'page.jpg');
    return call('POST', `/books/${bookId}/pages`, form);
  },
  getPage: (id) => call('GET', `/pages/${id}`),
  photoUrl: (pageId) => `${BASE}/pages/${pageId}/photo`,
  listMarks: (pageId) => call('GET', `/pages/${pageId}/marks`),
  editMark: (markId, edit) => call('PATCH', `/marks/${markId}`, edit),
  deleteMark: (markId) => call('DELETE', `/marks/${markId}`),
  addMark: (pageId, mark) => call('POST', `/pages/${pageId}/marks`, mark),
  confirm: (pageId) => call('POST', `/pages/${pageId}/confirm`),
  retry: (pageId) => call('POST', `/pages/${pageId}/retry`),
  pageResults: (pageId) => call('GET', `/pages/${pageId}/results`),
  deletePagePhoto: (pageId) => call('DELETE', `/pages/${pageId}/photo`),
  listItems({ q, kind }) {
    const params = new URLSearchParams();
    if (q?.trim()) params.set('q', q.trim());
    if (kind) params.set('kind', kind);
    const query = params.toString();
    return call('GET', `/wordbank${query ? `?${query}` : ''}`);
  },
  getItem: (id) => call('GET', `/wordbank/${id}`),
  editSense: (itemId, edit) => call('PATCH', `/wordbank/${itemId}`, edit),
  deleteItem: (id) => call('DELETE', `/wordbank/${id}`),
  dueCards: () => call('GET', '/review/due'),
  rateCard: (cardId, rating) => call('POST', `/review/${cardId}`, { rating }),
  deleteAccount: () => call('DELETE', '/account'),
};

export const ApiContext = createContext<Api>(httpApi);

export const useApi = () => useContext(ApiContext);

/** The reader-facing text of any error. */
export const messageOf = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.';
