import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import type { Api, ItemDetail, ItemSummary } from '../api';
import { TestApp } from '../test-app';
import { Settings } from './Settings';
import { ItemScreen, WordBank } from './WordBank';

const items: ItemSummary[] = [
  { id: 'i1', kind: 'word', normalForm: '가까스로', meanings: ['barely'], sightingCount: 2, createdAt: '2026-11-09T10:00:00Z' },
  { id: 'i2', kind: 'grammar', normalForm: '-(으)ㄹ 뿐', meanings: ['only'], sightingCount: 1, createdAt: '2026-11-08T10:00:00Z' },
];

const detail: ItemDetail = {
  id: 'i1',
  kind: 'word',
  normalForm: '가까스로',
  createdAt: '2026-11-09T10:00:00Z',
  senses: [
    {
      id: 's1',
      meaning: 'barely',
      notes: 'With effort.',
      example: '가까스로 시간에 맞췄다.',
      exampleTranslation: 'I barely made it in time.',
      sightings: [
        { id: 'g1', bookId: 'b1', bookTitle: '아몬드', pageId: 'p3', pageNumber: 3, sentence: '그는 가까스로 탈출했다.', sentenceTranslation: 'He barely escaped.', createdAt: '' },
        { id: 'g2', bookId: 'b1', bookTitle: '아몬드', pageId: 'p7', pageNumber: 7, sentence: '가까스로 시간에 맞췄다.', sentenceTranslation: null, createdAt: '' },
      ],
    },
  ],
};

function renderAt(path: string, api: Partial<Api>) {
  return render(
    <TestApp api={api} path={path}>
      <Routes>
        <Route path="/wordbank" element={<WordBank />} />
        <Route path="/wordbank/:itemId" element={<ItemScreen />} />
        <Route path="/settings" element={<Settings email="reader@example.com" onDeleted={() => {}} />} />
      </Routes>
    </TestApp>,
  );
}

describe('Word bank', () => {
  it('lists saved items and searches them', async () => {
    const user = userEvent.setup();
    const listItems = vi.fn(async () => items);
    renderAt('/wordbank', { listItems });
    expect(await screen.findByText('가까스로')).toBeInTheDocument();
    expect(screen.getByText('-(으)ㄹ 뿐')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search your word bank' }), '가까');
    await user.click(screen.getByRole('radio', { name: 'Grammar' }));
    expect(listItems).toHaveBeenLastCalledWith({ q: '가까', kind: 'grammar' });
  });

  it('shows every place an item was met', async () => {
    renderAt('/wordbank/i1', { getItem: vi.fn(async () => detail) });
    expect(await screen.findByText('그는 가까스로 탈출했다.')).toBeInTheDocument();
    expect(screen.getByText(/아몬드, page 3/)).toBeInTheDocument();
    expect(screen.getByText(/아몬드, page 7/)).toBeInTheDocument();
  });

  it('edits a meaning', async () => {
    const user = userEvent.setup();
    const editSense = vi.fn(async () => ({ ...detail, senses: [{ ...detail.senses[0], meaning: 'just barely' }] }));
    renderAt('/wordbank/i1', { getItem: vi.fn(async () => detail), editSense });
    await user.click(await screen.findByRole('button', { name: 'Edit meaning' }));
    const field = screen.getByLabelText('Meaning');
    await user.clear(field);
    await user.type(field, 'just barely');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(editSense).toHaveBeenCalledWith('i1', { senseId: 's1', meaning: 'just barely', notes: 'With effort.' });
    expect(await screen.findByText('just barely')).toBeInTheDocument();
  });
});

describe('asks for confirmation before deleting an item or the account', () => {
  it('deletes an item only after the second, explicit button', async () => {
    const user = userEvent.setup();
    const deleteItem = vi.fn(async () => {});
    renderAt('/wordbank/i1', { getItem: vi.fn(async () => detail), deleteItem, listItems: vi.fn(async () => []) });
    await user.click(await screen.findByRole('button', { name: 'Delete from word bank' }));
    expect(deleteItem).not.toHaveBeenCalled();
    expect(screen.getByText(/its 1 card/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('button', { name: 'Delete 가까스로' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Delete from word bank' }));
    await user.click(screen.getByRole('button', { name: 'Delete 가까스로' }));
    expect(deleteItem).toHaveBeenCalledWith('i1');
  });

  it('deletes the account only after the second, explicit button', async () => {
    const user = userEvent.setup();
    const deleteAccount = vi.fn(async () => {});
    renderAt('/settings', { deleteAccount });
    expect(screen.getByText('reader@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete my account and all my data' }));
    expect(deleteAccount).toHaveBeenCalled();
  });
});
