import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { messageOf, type RequestLinkAnswer, type User, useApi } from '../api';

/** Email sign-in. The emailed link comes back here with ?token=…, which signs the reader in. */
export function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<RequestLinkAnswer | null>(null);
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
      setSent(await api.requestLink(email.trim()));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (token && !error) return <p className="note">Signing you in…</p>;

  const again = (
    <button type="button" className="quiet-button" onClick={() => setSent(null)}>
      Use a different email
    </button>
  );

  // Only on a developer's own machine with no email service: the server hands the link back.
  if (sent?.dev && 'link' in sent.dev) {
    const url = new URL(sent.dev.link);
    return (
      <>
        <h1>Your sign-in link</h1>
        <p className="lede">No email service is set up on this computer, so nothing was emailed. Use the link here instead. It works once, for 15 minutes.</p>
        <p>
          <Link className="button primary wide" to={`${url.pathname}${url.search}`}>
            Sign in with this link
          </Link>
        </p>
        {again}
      </>
    );
  }

  if (sent?.dev && 'notAllowed' in sent.dev) {
    return (
      <>
        <h1>This address cannot sign in</h1>
        <p className="lede">
          <strong>{email.trim()}</strong> is not on the allowed list. Add it to <code>ALLOWED_EMAILS</code> in the <code>.env</code> file and restart the
          API, or set <code>SIGN_UP=open</code> to let any address sign in.
        </p>
        {again}
      </>
    );
  }

  if (sent) {
    return (
      <>
        <h1>Check your email</h1>
        <p className="lede">
          If <strong>{email.trim()}</strong> can sign in, a link is on its way. It works once, for 15 minutes.
        </p>
        <p className="note">Nothing after a minute or two? Look in your spam folder, then ask for a new link.</p>
        {again}
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
