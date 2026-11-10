import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { type Api, ApiContext, ApiError } from '../api';
import { SignIn } from './SignIn';

function renderSignIn(api: Partial<Api>, path = '/sign-in') {
  return render(
    <ApiContext.Provider value={api as Api}>
      <MemoryRouter initialEntries={[path]}>
        <SignIn onSignedIn={() => {}} />
      </MemoryRouter>
    </ApiContext.Provider>,
  );
}

async function ask(email = 'reader@example.com') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
}

describe('SignIn', () => {
  it('says to check email, and how long the link lasts', async () => {
    const requestLink = vi.fn(async () => ({}));
    renderSignIn({ requestLink });
    await ask(' reader@example.com ');
    expect(requestLink).toHaveBeenCalledWith('reader@example.com');
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/15 minutes/)).toBeInTheDocument();
    expect(screen.getByText(/spam/i)).toBeInTheDocument();
  });

  it('shows the link itself when this computer has no email service', async () => {
    renderSignIn({ requestLink: vi.fn(async () => ({ dev: { link: 'http://localhost:8080/sign-in?token=abc' } })) });
    await ask();
    const link = await screen.findByRole('link', { name: 'Sign in with this link' });
    expect(link).toHaveAttribute('href', '/sign-in?token=abc');
    expect(screen.getByText(/no email service is set up/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check your email' })).toBeNull();
  });

  it('says when the address is not on the allowed list of a local setup', async () => {
    renderSignIn({ requestLink: vi.fn(async () => ({ dev: { notAllowed: true as const } })) });
    await ask('stranger@example.com');
    expect(await screen.findByRole('heading', { name: 'This address cannot sign in' })).toBeInTheDocument();
    expect(screen.getByText('stranger@example.com')).toBeInTheDocument();
    expect(screen.getByText(/is not on the allowed list/)).toBeInTheDocument();
    expect(screen.getByText('ALLOWED_EMAILS')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check your email' })).toBeNull();
  });

  it('shows the server message when too many links were requested or the email could not be sent', async () => {
    const requestLink = vi.fn(async () => {
      throw new ApiError(429, 'Too many sign-in links were requested for this address. Use the latest one, or try again in 15 minutes.');
    });
    renderSignIn({ requestLink });
    await ask();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many sign-in links/);
    expect(screen.getByRole('button', { name: 'Email me a sign-in link' })).toBeEnabled();
  });

  it('explains an expired or used link and offers a new one', async () => {
    const verify = vi.fn(async () => {
      throw new ApiError(401, 'invalid');
    });
    renderSignIn({ verify }, '/sign-in?token=old');
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired or was already used/);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
});
