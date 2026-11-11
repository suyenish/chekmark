import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type Api, ApiError, type MarkInfo, type PageInfo } from '../api';
import { TestApp } from '../test-app';
import { PageScreen } from './PageScreen';

const basePage: PageInfo = {
  id: 'page-1',
  bookId: 'book-1',
  pageNumber: 12,
  status: 'AWAITING_CHECK',
  failedStage: null,
  failureReason: null,
  hasPhoto: true,
  photoUnusable: false,
  createdAt: '2026-11-09T10:00:00Z',
};

const mark = (id: string, type: MarkInfo['type'], text: string, order: number): MarkInfo => ({
  id,
  order,
  type,
  text,
  normalForm: type === 'underline_translate' || type === 'unclear' ? null : text,
  sentence: `${text}가 있는 문장.`,
  source: 'detected',
  saved: type === 'underline_save' || type === 'curly',
});

/** A fake API that keeps marks in memory, like the server would. */
function fakeApi(page: PageInfo, marks: MarkInfo[] = []) {
  let current = [...marks];
  const api = {
    getPage: vi.fn(async () => page),
    photoUrl: (id: string) => `/api/pages/${id}/photo`,
    listMarks: vi.fn(async () => current),
    editMark: vi.fn(async (id: string, edit: { type?: MarkInfo['type']; save?: boolean; text?: string }) => {
      current = current.map((m) => {
        if (m.id !== id) return m;
        if (edit.text !== undefined) return { ...m, text: edit.text, normalForm: null, source: 'corrected' };
        const type = edit.save === undefined ? edit.type! : edit.save ? 'underline_save' : 'underline_translate';
        return { ...m, type, saved: type !== 'underline_translate', source: 'corrected' };
      });
      return current.find((m) => m.id === id)!;
    }),
    deleteMark: vi.fn(async (id: string) => {
      current = current.filter((m) => m.id !== id);
    }),
    addMark: vi.fn(async (_pageId: string, input: { type: MarkInfo['type']; text: string }) => {
      const added: MarkInfo = { ...mark(`added-${current.length}`, input.type, input.text, current.length), normalForm: null, source: 'added' };
      current = [...current, added];
      return added;
    }),
    confirm: vi.fn(async () => ({ ...page, status: 'EXPLAINING' as const })),
    retry: vi.fn(async () => ({ ...page, status: 'UPLOADED' as const, failedStage: null, failureReason: null })),
  };
  return api;
}

function renderPage(api: ReturnType<typeof fakeApi>, pollMs?: number) {
  return render(
    <TestApp api={api as unknown as Api}>
      <PageScreen pageId="page-1" pollMs={pollMs} />
    </TestApp>,
  );
}

/** Astryx buttons stay focusable when disabled, so they say so with aria-disabled. */
const isOff = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true' || (button as HTMLButtonElement).disabled;

describe('Mark check', () => {
  it('lists the marks in page order', async () => {
    renderPage(fakeApi(basePage, [mark('m1', 'underline_save', '끄트머리', 0), mark('m2', 'curly', '비록', 1)]));
    const items = await screen.findAllByRole('listitem');
    expect(items.map((item) => within(item).getByTestId('mark-text').textContent)).toEqual(['끄트머리', '비록']);
  });

  it('disables Confirm while any mark is unclear', async () => {
    const user = userEvent.setup();
    const api = fakeApi(basePage, [mark('m1', 'curly', '비록', 0), mark('m2', 'unclear', '평평', 1)]);
    renderPage(api);
    const confirm = await screen.findByRole('button', { name: 'Confirm marks' });
    expect(isOff(confirm)).toBe(true);
    expect(screen.getByText(/1 unclear mark/)).toBeInTheDocument();
    await user.click(confirm);
    expect(api.confirm).not.toHaveBeenCalled(); // a disabled Confirm does nothing

    await user.click(screen.getByRole('button', { name: /평평/ }));
    await user.click(screen.getByRole('radio', { name: 'Underline' }));
    await waitFor(() => expect(isOff(screen.getByRole('button', { name: 'Confirm marks' }))).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Confirm marks' }));
    expect(api.confirm).toHaveBeenCalledWith('page-1');
  });

  it('changes a mark type when tapped', async () => {
    const user = userEvent.setup();
    const api = fakeApi(basePage, [mark('m1', 'underline_save', '비록', 0)]);
    renderPage(api);
    await user.click(await screen.findByRole('button', { name: /비록/ }));
    await user.click(screen.getByRole('radio', { name: 'Curly line' }));
    expect(api.editMark).toHaveBeenCalledWith('m1', { type: 'curly' });
    expect(await screen.findByText('Grammar')).toBeInTheDocument();
  });

  it('shows a save switch on every underline and none on curly marks', async () => {
    const user = userEvent.setup();
    const api = fakeApi(basePage, [
      mark('m1', 'underline_save', '끄트머리', 0),
      mark('m2', 'underline_translate', '너무나 기뻤다.', 1),
      mark('m3', 'curly', '비록', 2),
      mark('m4', 'unclear', '평평', 3),
    ]);
    renderPage(api);
    const switches = await screen.findAllByRole('switch', { name: /save to word bank/i });
    expect(switches).toHaveLength(2);
    expect(switches.map((s) => (s as HTMLInputElement).checked)).toEqual([true, false]);
    const curly = screen.getAllByRole('listitem')[2];
    expect(within(curly).queryByRole('switch')).toBeNull();

    await user.click(switches[1]);
    expect(api.editMark).toHaveBeenCalledWith('m2', { save: true });
    await waitFor(() => expect(screen.getAllByRole('switch', { name: /save to word bank/i })[1]).toBeChecked());
  });

  it('removes a mark', async () => {
    const user = userEvent.setup();
    const api = fakeApi(basePage, [mark('m1', 'curly', '비록', 0), mark('m2', 'unclear', '평평', 1)]);
    renderPage(api);
    await user.click(await screen.findByRole('button', { name: /평평/ }));
    await user.click(screen.getByRole('button', { name: 'Remove mark' }));
    expect(api.deleteMark).toHaveBeenCalledWith('m2');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(isOff(screen.getByRole('button', { name: 'Confirm marks' }))).toBe(false);
  });

  it('fixes the text of a misread mark', async () => {
    const user = userEvent.setup();
    const api = fakeApi(basePage, [mark('m1', 'underline_save', '평평', 0)]);
    renderPage(api);
    await user.click(await screen.findByRole('button', { name: /평평/ }));
    const field = screen.getByLabelText('Text of this mark');
    await user.clear(field);
    await user.type(field, '펑펑');
    await user.click(screen.getByRole('button', { name: 'Save text' }));
    expect(api.editMark).toHaveBeenCalledWith('m1', { text: '펑펑' });
    expect(await screen.findByTestId('mark-text')).toHaveTextContent('펑펑');
  });

  it('offers a new photo when no marks were found', async () => {
    renderPage(fakeApi(basePage, []));
    expect(await screen.findByText(/No marks were found/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Take a new photo' })).toHaveAttribute('href', '/books/book-1/capture?page=12');
    expect(isOff(screen.getByRole('button', { name: 'Confirm marks' }))).toBe(false); // finishing an unmarked page is allowed
  });

  it('adds a typed mark with the chosen type', async () => {
    const user = userEvent.setup();
    const api = fakeApi(basePage, [mark('m1', 'curly', '비록', 0)]);
    renderPage(api);
    await user.click(await screen.findByRole('button', { name: 'Add a missed mark' }));
    await user.type(screen.getByLabelText('Marked text'), '기뻤다');
    await user.click(screen.getByRole('radio', { name: /Sentence to translate/ }));
    await user.click(screen.getByRole('button', { name: 'Add mark' }));
    expect(api.addMark).toHaveBeenCalledWith('page-1', { type: 'underline_translate', text: '기뻤다' });
    expect(await screen.findByText('기뻤다')).toBeInTheDocument();
  });

  it('says plainly that the beta can misread marks', async () => {
    renderPage(fakeApi(basePage, [mark('m1', 'curly', '비록', 0)]));
    expect(await screen.findByText(/can miss or misread/i)).toBeInTheDocument();
  });
});

describe('page status', () => {
  it('shows the retake message when the page failed as unusable', async () => {
    const api = fakeApi({
      ...basePage,
      status: 'FAILED',
      failedStage: 'DETECTING',
      failureReason: 'The photo is too dark to read.',
      photoUnusable: true,
    });
    renderPage(api);
    expect(await screen.findByText('The photo is too dark to read.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Take a new photo' })).toHaveAttribute('href', '/books/book-1/capture?page=12');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows Retry on any other failed page', async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      ...basePage,
      status: 'FAILED',
      failedStage: 'EXPLAINING',
      failureReason: 'We could not explain this page right now. Please try again.',
    });
    renderPage(api);
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(api.retry).toHaveBeenCalledWith('page-1');
    expect(screen.queryByRole('link', { name: 'Take a new photo' })).toBeNull();
  });

  it('shows progress while the marks are being read', async () => {
    renderPage(fakeApi({ ...basePage, status: 'DETECTING' }));
    expect(await screen.findByText(/Reading your pencil marks/)).toBeInTheDocument();
  });

  it('keeps checking after a failed request while the marks are read, and says so', async () => {
    const api = fakeApi(basePage, [mark('m1', 'curly', '비록', 0)]);
    api.getPage
      .mockResolvedValueOnce({ ...basePage, status: 'DETECTING' })
      .mockRejectedValueOnce(new Error('Could not reach Chekmark. Check your connection and try again.'))
      .mockResolvedValue(basePage);
    renderPage(api, 10);
    expect(await screen.findByText(/Could not reach Chekmark/)).toBeInTheDocument();
    expect(screen.getByText(/Reading your pencil marks/)).toBeInTheDocument(); // still waiting, not a dead end
    expect(await screen.findByRole('button', { name: 'Confirm marks' })).toBeInTheDocument();
    expect(screen.queryByText(/Could not reach Chekmark/)).toBeNull();
  });

  it('says a page was not found, instead of waiting for it forever', async () => {
    const api = fakeApi(basePage);
    api.getPage.mockRejectedValue(new ApiError(404, 'Page not found'));
    renderPage(api, 10);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your books' })).toHaveAttribute('href', '/');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(api.getPage).toHaveBeenCalledTimes(1);
  });
});
