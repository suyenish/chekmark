import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { type Api, ApiContext } from '../api';
import { Capture } from './Capture';

describe('Capture', () => {
  it('shows a clear error when the browser cannot read the chosen file', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const api = { uploadPage: vi.fn() } as unknown as Api;
    render(
      <ApiContext.Provider value={api}>
        <MemoryRouter initialEntries={['/books/b1/capture?page=7']}>
          <Routes>
            <Route path="/books/:bookId/capture" element={<Capture />} />
          </Routes>
        </MemoryRouter>
      </ApiContext.Provider>,
    );
    expect(screen.getByLabelText('Page number')).toHaveValue(7);
    // jsdom cannot decode images, just as a browser cannot decode a text file.
    await user.upload(screen.getByLabelText(/Take or choose a photo/), new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read this file as a photo/i);
    expect(screen.getByRole('button', { name: 'Upload page' })).toBeDisabled();
    expect(api.uploadPage).not.toHaveBeenCalled();
  });
});
