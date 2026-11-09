import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { messageOf, useApi } from '../api';
import { preparePhoto } from '../photo';

/**
 * Page number and one photo. A plain file input opens the phone's own camera
 * or photo library, which works on every phone, unlike a live camera view.
 */
export function Capture() {
  const api = useApi();
  const navigate = useNavigate();
  const { bookId = '' } = useParams();
  const [params] = useSearchParams();
  const [pageNumber, setPageNumber] = useState(params.get('page') ?? '');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preparing' | 'uploading' | null>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPhoto(null);
    setBusy('preparing');
    try {
      const prepared = await preparePhoto(file);
      setPhoto(prepared);
      setPreview(URL.createObjectURL(prepared));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!photo) return;
    setError(null);
    setBusy('uploading');
    try {
      const page = await api.uploadPage(bookId, Number(pageNumber), photo);
      navigate(`/pages/${page.id}`);
    } catch (e) {
      setError(messageOf(e));
      setBusy(null);
    }
  }

  const validNumber = /^\d+$/.test(pageNumber) && Number(pageNumber) >= 1;

  return (
    <form onSubmit={upload}>
      <p>
        <Link to={`/books/${bookId}`}>Back to the book</Link>
      </p>
      <h1>Add a page</h1>
      <label className="field">
        <span>Page number</span>
        <input type="number" inputMode="numeric" min={1} required value={pageNumber} onChange={(e) => setPageNumber(e.target.value)} />
      </label>

      <label className="photo-picker">
        <input type="file" accept="image/*" onChange={(e) => choose(e.target.files?.[0])} />
        <strong>{photo ? 'Choose a different photo' : 'Take or choose a photo'}</strong>
        <span className="note" style={{ display: 'block' }}>
          Hold the phone flat over the page, in good light, with the whole page in view.
        </span>
      </label>
      {busy === 'preparing' && <p className="note">Preparing the photo…</p>}
      {preview && <img className="preview" src={preview} alt="The page you are about to upload" />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="action-bar">
        <div>
          <button type="submit" className="button primary wide" disabled={!photo || !validNumber || busy !== null}>
            {busy === 'uploading' ? 'Uploading…' : 'Upload page'}
          </button>
        </div>
      </div>
    </form>
  );
}
