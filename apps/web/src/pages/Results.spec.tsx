import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Api, PageInfo, PageResult } from '../api';
import { TestApp } from '../test-app';
import { Results } from './Results';

const page: PageInfo = {
  id: 'page-1',
  bookId: 'book-1',
  pageNumber: 37,
  status: 'DONE',
  failedStage: null,
  failureReason: null,
  hasPhoto: true,
  photoUnusable: false,
  createdAt: '2026-11-09T10:00:00Z',
};

const SENTENCE = '비록 긴 줄의 끄트머리에 섰을 뿐이지만, 너무나 기뻤다.';

const results: PageResult[] = [
  { markId: 'm1', kind: 'translation', text: '너무나 기뻤다.', translation: 'I was so happy.' },
  {
    markId: 'm2',
    kind: 'grammar',
    text: '비록',
    normalForm: '비록 -지만',
    itemId: 'i2',
    senseId: 's2',
    meaning: 'even though',
    notes: 'Pairs with -지만 or -아/어도.',
    example: '비록 비가 왔지만 갔어요.',
    exampleTranslation: 'Even though it rained, I went.',
    sentence: SENTENCE,
    sentenceTranslation: 'Although I was only a freshman at the very end of the list, I was so happy.',
    seenBefore: [],
  },
  {
    markId: 'm3',
    kind: 'word',
    text: '끄트머리에',
    normalForm: '끄트머리',
    itemId: 'i3',
    senseId: 's3',
    meaning: 'the very end',
    notes: 'Informal for 끝.',
    example: '줄의 끄트머리에 섰다.',
    exampleTranslation: 'I stood at the very end of the line.',
    sentence: SENTENCE,
    sentenceTranslation: 'Although I was only a freshman at the very end of the list, I was so happy.',
    seenBefore: [{ bookId: 'book-1', bookTitle: '아몬드', pageId: 'p12', pageNumber: 12, sentence: '그는 줄의 끄트머리에 서 있었다.' }],
  },
];

function renderResults(api: Partial<Api>) {
  return render(
    <TestApp api={api}>
      <Results page={page} onPhotoDeleted={() => {}} />
    </TestApp>,
  );
}

describe('Results', () => {
  it('shows word, grammar and translation results in mark order', async () => {
    renderResults({ pageResults: vi.fn(async () => results) });
    const items = await screen.findAllByRole('article');
    expect(items.map((item) => within(item).getByTestId('marked').textContent)).toEqual(['너무나 기뻤다.', '비록', '끄트머리에']);

    expect(within(items[0]).getByText('I was so happy.')).toBeInTheDocument();
    expect(within(items[1]).getByText('Grammar')).toBeInTheDocument();
    expect(within(items[1]).getByText('비록 -지만')).toBeInTheDocument();
    expect(within(items[1]).getByText('even though')).toBeInTheDocument();
    expect(within(items[1]).getByText('비록 비가 왔지만 갔어요.')).toBeInTheDocument();
    expect(within(items[2]).getByText('Word')).toBeInTheDocument();
    expect(within(items[2]).getByText('the very end')).toBeInTheDocument();
  });

  it('shows "You saw this on page 12" with the earlier sentence', async () => {
    renderResults({ pageResults: vi.fn(async () => results) });
    const items = await screen.findAllByRole('article');
    expect(within(items[2]).getByText(/You saw this on page 12/)).toBeInTheDocument();
    expect(within(items[2]).getByText('그는 줄의 끄트머리에 서 있었다.')).toBeInTheDocument();
    expect(within(items[1]).queryByText(/You saw this/)).toBeNull();
  });

  it('asks before deleting the photo, and keeps the results', async () => {
    const user = userEvent.setup();
    const deletePagePhoto = vi.fn(async () => {});
    renderResults({ pageResults: vi.fn(async () => results), deletePagePhoto });
    await user.click(await screen.findByRole('button', { name: 'Delete photo' }));
    expect(deletePagePhoto).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete the photo' }));
    expect(deletePagePhoto).toHaveBeenCalledWith('page-1');
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });
});
