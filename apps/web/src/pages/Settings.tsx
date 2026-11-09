import { useState } from 'react';
import { messageOf, useApi } from '../api';

/** The account: who is signed in, how photos are kept, and deleting everything. */
export function Settings({ email, onDeleted }: { email: string; onDeleted: () => void }) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      onDeleted();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Settings</h1>
      <h2>Account</h2>
      <p>
        Signed in as <strong>{email}</strong>
      </p>
      <h2>Your photos</h2>
      <p className="lede">
        Page photos are private and are deleted 30 days after a page is processed. You can delete one sooner from its results page. Your marks, results and
        word bank are kept.
      </p>

      <section className="danger-zone">
        <h2>Delete account</h2>
        {confirming ? (
          <>
            <p>
              This deletes your account, every book and page, every photo, your word bank and your cards. It cannot be undone.
            </p>
            <div className="editor">
              <button type="button" className="button danger" disabled={busy} onClick={remove}>
                Delete my account and all my data
              </button>
              <button type="button" className="quiet-button" onClick={() => setConfirming(false)}>
                Keep my account
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="button" onClick={() => setConfirming(true)}>
            Delete account
          </button>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </>
  );
}
