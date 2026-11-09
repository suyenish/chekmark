import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { type Api, ApiContext, type DueCard } from '../api';
import { Review } from './Review';

const card = (id: string, overrides: Partial<DueCard> = {}): DueCard => ({
  cardId: id,
  kind: 'word',
  normalForm: '겁먹다',
  front: { sentence: '그는 겁먹고 도망쳤다.', highlight: { text: '겁먹고', start: 3 } },
  back: {
    meaning: 'to get scared',
    notes: '겁 (fear) + 먹다',
    example: '그는 큰 개를 보고 겁먹었다.',
    exampleTranslation: 'He got scared when he saw the big dog.',
    sentenceTranslation: 'He got scared and ran away.',
  },
  source: { bookTitle: '아몬드', pageNumber: 37 },
  ...overrides,
});

function renderReview(api: Partial<Api>) {
  return render(
    <ApiContext.Provider value={api as Api}>
      <MemoryRouter>
        <Review />
      </MemoryRouter>
    </ApiContext.Provider>,
  );
}

describe('Review', () => {
  it('shows the front of a card first, and the back and ratings after a tap', async () => {
    const user = userEvent.setup();
    renderReview({ dueCards: vi.fn(async () => [card('c1')]), rateCard: vi.fn() });

    const highlighted = await screen.findByText('겁먹고');
    expect(highlighted.tagName).toBe('MARK');
    expect(screen.getByTestId('front')).toHaveTextContent('그는 겁먹고 도망쳤다.');
    expect(screen.queryByText('to get scared')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Easy' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show answer' }));
    expect(screen.getByText('to get scared')).toBeInTheDocument();
    expect(screen.getByText('겁먹다')).toBeInTheDocument();
    expect(screen.getByText('He got scared and ran away.')).toBeInTheDocument();
    expect(screen.getByText(/아몬드, page 37/)).toBeInTheDocument();
  });

  it('offers exactly Again, Hard and Easy', async () => {
    const user = userEvent.setup();
    const rateCard = vi.fn(async () => ({ cardId: 'c1', dueAt: '2026-11-12T00:00:00Z', intervalDays: 3, ease: 2.55 }));
    renderReview({ dueCards: vi.fn(async () => [card('c1'), card('c2', { normalForm: '가까스로' })]), rateCard });

    await user.click(await screen.findByRole('button', { name: 'Show answer' }));
    const ratings = screen.getAllByRole('button').filter((b) => ['Again', 'Hard', 'Easy'].includes(b.textContent ?? ''));
    expect(ratings.map((b) => b.textContent)).toEqual(['Again', 'Hard', 'Easy']);

    await user.click(screen.getByRole('button', { name: 'Easy' }));
    expect(rateCard).toHaveBeenCalledWith('c1', 'easy');
    // The next card starts on its front again.
    expect(await screen.findByText('1 left')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show answer' })).toBeInTheDocument();
  });

  it('shows an empty message when nothing is due', async () => {
    renderReview({ dueCards: vi.fn(async () => []) });
    expect(await screen.findByText(/Nothing to review right now/)).toBeInTheDocument();
  });

  it('shows the sentence without highlighting when highlight is null', async () => {
    renderReview({
      dueCards: vi.fn(async () => [card('c1', { kind: 'grammar', normalForm: '-(으)ㄹ 뿐', front: { sentence: '줄을 선 것뿐이다.', highlight: null } })]),
    });
    const front = await screen.findByTestId('front');
    expect(front).toHaveTextContent('줄을 선 것뿐이다.');
    expect(front.querySelector('mark')).toBeNull();
  });

  it('says when every due card is done', async () => {
    const user = userEvent.setup();
    const rateCard = vi.fn(async () => ({ cardId: 'c1', dueAt: '2026-11-10T00:00:00Z', intervalDays: 1, ease: 2.35 }));
    renderReview({ dueCards: vi.fn().mockResolvedValueOnce([card('c1')]).mockResolvedValue([]), rateCard });
    await user.click(await screen.findByRole('button', { name: 'Show answer' }));
    await user.click(screen.getByRole('button', { name: 'Hard' }));
    expect(await screen.findByText(/All done for now/)).toBeInTheDocument();
  });
});
