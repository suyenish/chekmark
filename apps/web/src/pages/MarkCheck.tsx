import { type FormEvent, useEffect, useState } from 'react';
import { type ChosenMarkType, type MarkEdit, type MarkInfo, messageOf, type PageInfo, useApi } from '../api';

const LABELS: Record<MarkInfo['type'], string> = {
  underline_save: 'Word to save',
  underline_translate: 'Translate only',
  curly: 'Grammar',
  unclear: 'Unclear: choose a type',
};

const isUnderline = (mark: MarkInfo) => mark.type === 'underline_save' || mark.type === 'underline_translate';

const ADD_TYPES: { type: ChosenMarkType; label: string }[] = [
  { type: 'underline_save', label: 'Word or phrase to save' },
  { type: 'underline_translate', label: 'Sentence to translate' },
  { type: 'curly', label: 'Grammar (curly line)' },
];

/**
 * The reader checks what was read from their page: changes a mark's type,
 * flips the save switch on underlines, removes wrong marks, adds missed ones,
 * then confirms. Confirm waits until no mark is unclear.
 */
export function MarkCheck({ page, onConfirmed }: { page: PageInfo; onConfirmed: (page: PageInfo) => void }) {
  const api = useApi();
  const [marks, setMarks] = useState<MarkInfo[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listMarks(page.id).then(setMarks, (e: unknown) => setError(messageOf(e)));
  }, [api, page.id]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const edit = (mark: MarkInfo, change: MarkEdit) =>
    run(async () => {
      const updated = await api.editMark(mark.id, change);
      setMarks((list) => list?.map((m) => (m.id === updated.id ? updated : m)) ?? null);
    });

  const remove = (mark: MarkInfo) =>
    run(async () => {
      await api.deleteMark(mark.id);
      setMarks((list) => list?.filter((m) => m.id !== mark.id) ?? null);
      setOpen(null);
    });

  const confirm = () => run(async () => onConfirmed(await api.confirm(page.id)));

  if (!marks) return error ? <p className="error">{error}</p> : <p className="note">Loading marks…</p>;

  const unclear = marks.filter((mark) => mark.type === 'unclear').length;

  return (
    <>
      <h1>Check your marks</h1>
      <p className="beta-note">Beta: the app can miss or misread pencil marks. Check each one against your page before you confirm.</p>

      {page.hasPhoto && (
        <details className="photo">
          <summary>Compare with your photo</summary>
          <img src={api.photoUrl(page.id)} alt={`Your photo of page ${page.pageNumber ?? ''}`} />
        </details>
      )}

      {marks.length === 0 ? (
        <p className="lede">No marks were found on this photo. Add any the app missed, or confirm to finish the page.</p>
      ) : (
        <ul className="marks">
          {marks.map((mark) => (
            <li key={mark.id} className={`mark-${mark.type}`}>
              <div className="mark-head">
                <button
                  type="button"
                  className="mark-tap"
                  aria-expanded={open === mark.id}
                  onClick={() => setOpen(open === mark.id ? null : mark.id)}
                >
                  <span className="mark-text" data-testid="mark-text" lang="ko">
                    {mark.text}
                  </span>
                  <span className="mark-label">{LABELS[mark.type]}</span>
                </button>
                {isUnderline(mark) && (
                  <button
                    type="button"
                    role="switch"
                    className="switch"
                    aria-checked={mark.type === 'underline_save'}
                    aria-label={`Save to word bank: ${mark.text}`}
                    disabled={busy}
                    onClick={() => edit(mark, { save: mark.type !== 'underline_save' })}
                  >
                    <span className="track" aria-hidden="true" />
                  </button>
                )}
              </div>
              {open === mark.id && (
                <>
                  {mark.sentence && (
                    <p className="mark-sentence" lang="ko">
                      {mark.sentence}
                    </p>
                  )}
                  <div className="editor">
                    <button
                      type="button"
                      className="choice"
                      aria-pressed={isUnderline(mark)}
                      disabled={busy}
                      onClick={() => !isUnderline(mark) && edit(mark, { type: 'underline_save' })}
                    >
                      Underline
                    </button>
                    <button
                      type="button"
                      className="choice"
                      aria-pressed={mark.type === 'curly'}
                      disabled={busy}
                      onClick={() => mark.type !== 'curly' && edit(mark, { type: 'curly' })}
                    >
                      Curly line
                    </button>
                    <button type="button" className="remove" disabled={busy} onClick={() => remove(mark)}>
                      Remove mark
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <AddMark
          busy={busy}
          onCancel={() => setAdding(false)}
          onAdd={(type, text) =>
            run(async () => {
              const added = await api.addMark(page.id, { type, text });
              setMarks((list) => [...(list ?? []), added]);
              setAdding(false);
            })
          }
        />
      ) : (
        <p>
          <button type="button" className="button" onClick={() => setAdding(true)}>
            Add a missed mark
          </button>
        </p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="action-bar">
        <div>
          {unclear > 0 && (
            <p className="note">
              Choose a type for {unclear} unclear mark{unclear === 1 ? '' : 's'}, or remove {unclear === 1 ? 'it' : 'them'}, to continue.
            </p>
          )}
          <button type="button" className="button primary wide" disabled={busy || unclear > 0} onClick={confirm}>
            Confirm marks
          </button>
        </div>
      </div>
    </>
  );
}

function AddMark({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (type: ChosenMarkType, text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [type, setType] = useState<ChosenMarkType>('underline_save');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (text.trim()) onAdd(type, text.trim());
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <label className="field">
        <span>Marked text</span>
        <input type="text" lang="ko" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </label>
      <fieldset className="types">
        <legend>What kind of mark is it?</legend>
        {ADD_TYPES.map((option) => (
          <label key={option.type}>
            <input type="radio" name="type" checked={type === option.type} onChange={() => setType(option.type)} />
            {option.label}
          </label>
        ))}
      </fieldset>
      <div className="editor">
        <button type="submit" className="button primary" disabled={busy || !text.trim()}>
          Add mark
        </button>
        <button type="button" className="quiet-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
