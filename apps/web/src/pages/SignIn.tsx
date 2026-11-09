import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { messageOf, type User, useApi } from '../api';

/** Email sign-in. The emailed link comes back here with ?token=…, which signs the reader in. */
export function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const verifying = useRef(false);

  useEffect(() => {
    if (!token || verifying.current) return; // a link works once, so it is used once
    verifying.current = true;
    api.verify(token).then(
      (user) => {
        onSignedIn(user);
        navigate('/', { replace: true });
      },
      () => setError('This sign-in link has expired or was already used. Enter your email to get a new one.'),
    );
  }, [api, token, navigate, onSignedIn]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestLink(email.trim());
      setSent(true);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (token && !error) return <p className="note">Signing you in…</p>;

  if (sent) {
    return (
      <>
        <h1>Check your email</h1>
        <p className="lede">
          If <strong>{email.trim()}</strong> is on the list for the beta, a sign-in link is on its way. It works once, for 15 minutes.
        </p>
        <button type="button" className="quiet-button" onClick={() => setSent(false)}>
          Use a different email
        </button>
      </>
    );
  }

  return (
    <>
      <h1>Your pencil marks, explained</h1>
      <p className="lede">Underline a page of your Korean book, take a photo, and the words and grammar you marked become your study cards.</p>
      <form onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button primary wide" disabled={busy}>
          Email me a sign-in link
        </button>
      </form>
    </>
  );
}
