import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { type ItemDetail, type ItemKind, type ItemSummary, messageOf, type Sense, useApi } from '../api';

const FILTERS: { kind: ItemKind | undefined; label: string }[] = [
  { kind: undefined, label: 'All' },
  { kind: 'word', label: 'Words' },
  { kind: 'grammar', label: 'Grammar' },
];

/** Every saved word and grammar pattern, newest first, searchable by form or meaning. */
export function WordBank() {
  const api = useApi();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<ItemKind | undefined>(undefined);
  const [items, setItems] = useState<ItemSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current; // only the newest search may update the list
    api.listItems({ q, kind }).then(
      (found) => request === latest.current && setItems(found),
      (e: unknown) => request === latest.current && setError(messageOf(e)),
    );
  }, [api, q, kind]);

  return (
    <>
      <h1>Word bank</h1>
      <label className="field">
        <span className="visually-hidden">Search your word bank</span>
        <input type="search" aria-label="Search your word bank" placeholder="Search by word or meaning" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="filters" role="radiogroup" aria-label="Show">
        {FILTERS.map((filter) => (
          <label key={filter.label} className="choice-label">
            <input type="radio" name="kind" checked={kind === filter.kind} onChange={() => setKind(filter.kind)} />
            <span className="choice">{filter.label}</span>
          </label>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {items && items.length === 0 && (
        <p className="lede">{q || kind ? 'Nothing matches that search.' : 'Words and grammar you mark will appear here after you confirm a page.'}</p>
      )}
      {items && items.length > 0 && (
        <ul className="rows">
          {items.map((item) => (
            <li key={item.id}>
              <Link className="row stacked" to={`/wordbank/${item.id}`}>
                <span className="title" lang="ko">
                  {item.normalForm}
                </span>
                <span className="meta">{item.meanings.join('; ')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One item: its meanings, every place it was met, and edit or delete. */
export function ItemScreen() {
  const api = useApi();
  const navigate = useNavigate();
  const { itemId = '' } = useParams();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getItem(itemId).then(setItem, (e: unknown) => setError(messageOf(e)));
  }, [api, itemId]);

  async function remove() {
    setError(null);
    try {
      await api.deleteItem(itemId);
      navigate('/wordbank', { replace: true });
    } catch (e) {
      setError(messageOf(e));
    }
  }

  if (!item) return error ? <p className="error">{error}</p> : <p className="note">Loading…</p>;

  const cards = item.senses.length;
  return (
    <>
      <p>
        <Link to="/wordbank">Word bank</Link>
      </p>
      <h1 className="korean" lang="ko">
        {item.normalForm}
      </h1>
      <p className="lede">{item.kind === 'word' ? 'Word' : 'Grammar'}</p>

      {item.senses.map((sense, index) => (
        <section key={sense.id} className="sense">
          {item.senses.length > 1 && <h2>Meaning {index + 1}</h2>}
          {editing === sense.id ? (
            <EditSense
              sense={sense}
              onCancel={() => setEditing(null)}
              onSave={async (meaning, notes) => {
                setError(null);
                try {
                  setItem(await api.editSense(item.id, { senseId: sense.id, meaning, notes }));
                  setEditing(null);
                } catch (e) {
                  setError(messageOf(e));
                }
              }}
            />
          ) : (
            <>
              <p className="result-meaning">{sense.meaning}</p>
              {sense.notes && <p className="result-notes">{sense.notes}</p>}
              {sense.example && (
                <p className="card-example">
                  <span className="korean" lang="ko">
                    {sense.example}
                  </span>
                  {sense.exampleTranslation && <span className="translation">{sense.exampleTranslation}</span>}
                </p>
              )}
              <button type="button" className="quiet-button" onClick={() => setEditing(sense.id)}>
                Edit meaning
              </button>
            </>
          )}
          <h2>Where you met it</h2>
          <ul className="sightings">
            {sense.sightings.map((sighting) => (
              <li key={sighting.id}>
                <p className="korean" lang="ko">
                  {sighting.sentence}
                </p>
                {sighting.sentenceTranslation && <p className="translation">{sighting.sentenceTranslation}</p>}
                <p className="note">
                  <Link to={`/pages/${sighting.pageId}`}>
                    {sighting.bookTitle}, page {sighting.pageNumber}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="danger-zone">
        {confirming ? (
          <>
            <p>
              Delete <span lang="ko">{item.normalForm}</span> with its meanings, the places you met it, and its {cards} card{cards === 1 ? '' : 's'}? This
              cannot be undone. Your pages and their results stay.
            </p>
            <div className="editor">
              <button type="button" className="button danger" onClick={remove}>
                Delete {item.normalForm}
              </button>
              <button type="button" className="quiet-button" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="quiet-button" onClick={() => setConfirming(true)}>
            Delete from word bank
          </button>
        )}
      </section>
    </>
  );
}

function EditSense({ sense, onSave, onCancel }: { sense: Sense; onSave: (meaning: string, notes: string | null) => void; onCancel: () => void }) {
  const [meaning, setMeaning] = useState(sense.meaning);
  const [notes, setNotes] = useState(sense.notes ?? '');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (meaning.trim()) onSave(meaning.trim(), notes.trim() || null);
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <label className="field">
        <span>Meaning</span>
        <input type="text" value={meaning} onChange={(e) => setMeaning(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Note</span>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="editor">
        <button type="submit" className="button primary" disabled={!meaning.trim()}>
          Save
        </button>
        <button type="button" className="quiet-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
