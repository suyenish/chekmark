import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import type { Api } from '../api';
import { TestApp } from '../test-app';
import { Capture } from './Capture';

it('in the demo, explains that upload is off instead of asking for a photo', () => {
  render(
    <TestApp api={{}} path="/books/b1/capture">
      <Capture demo />
    </TestApp>,
  );
  expect(screen.getByText(/switched off in the demo/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /upload/i })).toBeNull();
});

describe('Capture', () => {
  it('shows a clear error when the browser cannot read the chosen file', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const api = { uploadPage: vi.fn() } as unknown as Api;
    const { container } = render(
      <TestApp api={api} path="/books/b1/capture?page=7">
        <Routes>
          <Route path="/books/:bookId/capture" element={<Capture />} />
        </Routes>
      </TestApp>,
    );
    expect(screen.getByLabelText('Page number')).toHaveValue('7');
    // jsdom cannot decode images, just as a browser cannot decode a damaged one.
    await user.upload(container.querySelector<HTMLInputElement>('input[type=file]')!, new File(['not really an image'], 'broken.png', { type: 'image/png' }));
    const message = await screen.findByText(/could not read this file as a photo/i);
    expect(message.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Upload page' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Upload page' }));
    expect(api.uploadPage).not.toHaveBeenCalled();
  });
});
