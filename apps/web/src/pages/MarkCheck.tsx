import { type FormEvent, useEffect, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Spinner } from '@astryxdesign/core/Spinner';
import { StackItem } from '@astryxdesign/core/Stack';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { type ChosenMarkType, type MarkEdit, type MarkInfo, messageOf, type PageInfo, useApi } from '../api';
import { ErrorNote } from '../ui';

const LABELS: Record<MarkInfo['type'], string> = {
  underline_save: 'Word to save',
  underline_translate: 'Translate only',
  curly: 'Grammar',
  unclear: 'Unclear: choose a kind',
};

const isUnderline = (mark: MarkInfo) => mark.type === 'underline_save' || mark.type === 'underline_translate';
/** Which physical mark this is: a straight line or a wavy one. Unclear marks are neither yet. */
const shapeOf = (mark: MarkInfo) => (isUnderline(mark) ? 'underline' : mark.type === 'curly' ? 'curly' : '');

/**
 * The reader checks what was read from their page: changes a mark's kind,
 * flips the save switch on underlines, fixes misread text, removes wrong
 * marks, adds missed ones, then confirms. Confirm waits until no mark is unclear.
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

  if (!marks) return error ? <ErrorNote message={error} /> : <Spinner size="lg" label="Loading your marks…" />;

  const unclear = marks.filter((mark) => mark.type === 'unclear').length;
  const retake = `/books/${page.bookId}/capture?page=${page.pageNumber ?? ''}`;

  return (
    <VStack gap={5}>
      <VStack gap={2}>
        <Heading level={1}>Check your marks</Heading>
        <Text type="large" color="secondary" as="p">
          Page {page.pageNumber}. Tap a mark to change it.
        </Text>
      </VStack>

      <Banner
        status="warning"
        title="Compare each mark with your page"
        description="Chekmark is in beta and can miss or misread pencil marks. Only what you confirm here is explained and saved."
        collapsible={false}
      />

      {page.hasPhoto && (
        <Collapsible trigger="Compare with your photo" defaultIsOpen={false}>
          <img className="photo-preview" src={api.photoUrl(page.id)} alt={`Your photo of page ${page.pageNumber ?? ''}`} />
        </Collapsible>
      )}

      {marks.length === 0 ? (
        <VStack gap={3} hAlign="start">
          <Text as="p">No marks were found on this photo. Take a clearer photo, add the marks yourself, or confirm to finish the page with nothing saved.</Text>
          <Button label="Take a new photo" href={retake} />
        </VStack>
      ) : (
        <ul className="marks">
          {marks.map((mark) => (
            <li key={mark.id} className={`mark-${mark.type}`}>
              <HStack gap={3} vAlign="center">
                <button type="button" className="mark-tap" aria-expanded={open === mark.id} onClick={() => setOpen(open === mark.id ? null : mark.id)}>
                  <span className="mark-text" data-testid="mark-text" lang="ko">
                    {mark.text}
                  </span>
                  <Text type="supporting" color={mark.type === 'unclear' ? 'accent' : 'secondary'} weight={mark.type === 'unclear' ? 'semibold' : undefined}>
                    {LABELS[mark.type]}
                  </Text>
                </button>
                {isUnderline(mark) && (
                  <Switch
                    label={`Save to word bank: ${mark.text}`}
                    isLabelHidden
                    value={mark.type === 'underline_save'}
                    isDisabled={busy}
                    onChange={(save) => void edit(mark, { save })}
                  />
                )}
              </HStack>
              {open === mark.id && (
                <MarkEditor
                  mark={mark}
                  busy={busy}
                  onShape={(shape) => void edit(mark, { type: shape === 'curly' ? 'curly' : 'underline_save' })}
                  onText={(text) => void edit(mark, { text })}
                  onRemove={() => void remove(mark)}
                />
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
            void run(async () => {
              const added = await api.addMark(page.id, { type, text });
              setMarks((list) => [...(list ?? []), added]);
              setAdding(false);
            })
          }
        />
      ) : (
        <HStack>
          <Button label="Add a missed mark" onClick={() => setAdding(true)} />
        </HStack>
      )}

      <ErrorNote message={error} />

      <div className="action-bar">
        <VStack gap={2}>
          {unclear > 0 && (
            <Text type="supporting" as="p">
              Choose a kind for {unclear} unclear mark{unclear === 1 ? '' : 's'}, or remove {unclear === 1 ? 'it' : 'them'}, to continue.
            </Text>
          )}
          <Button label="Confirm marks" variant="primary" size="lg" width="100%" isDisabled={unclear > 0} isLoading={busy} onClick={() => void confirm()} />
        </VStack>
      </div>
    </VStack>
  );
}

/** Opened under a mark: its sentence, its kind, its text, and removing it. */
function MarkEditor({
  mark,
  busy,
  onShape,
  onText,
  onRemove,
}: {
  mark: MarkInfo;
  busy: boolean;
  onShape: (shape: string) => void;
  onText: (text: string) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(mark.text);
  const changed = text.trim() !== '' && text.trim() !== mark.text;

  return (
    <VStack gap={4} paddingBlock={3}>
      {mark.sentence && (
        <Text type="supporting" as="p">
          <span className="korean" lang="ko">
            {mark.sentence}
          </span>
        </Text>
      )}
      <SegmentedControl label="Kind of mark" value={shapeOf(mark)} onChange={(shape) => shape !== shapeOf(mark) && onShape(shape)} isDisabled={busy} layout="fill">
        <SegmentedControlItem value="underline" label="Underline" />
        <SegmentedControlItem value="curly" label="Curly line" />
      </SegmentedControl>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) onText(text.trim());
        }}
      >
        <HStack gap={2} vAlign="end">
          <StackItem size="fill">
            <TextInput label="Text of this mark" description="Fix it if a letter was misread or the mark was cut short." value={text} onChange={setText} width="100%" />
          </StackItem>
          <StackItem size="static">
            <Button label="Save text" type="submit" isDisabled={!changed || busy} />
          </StackItem>
        </HStack>
      </form>
      <HStack hAlign="end">
        <Button label="Remove mark" variant="destructive" size="sm" isDisabled={busy} onClick={onRemove} />
      </HStack>
    </VStack>
  );
}

const ADD_TYPES: { type: ChosenMarkType; label: string; description: string }[] = [
  { type: 'underline_save', label: 'Word or phrase to save', description: 'Explained and added to your word bank.' },
  { type: 'underline_translate', label: 'Sentence to translate', description: 'Translated, not saved.' },
  { type: 'curly', label: 'Grammar (curly line)', description: 'The pattern is explained and saved.' },
];

function AddMark({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (type: ChosenMarkType, text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [type, setType] = useState<ChosenMarkType>('underline_save');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (text.trim()) onAdd(type, text.trim());
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <VStack gap={4}>
          <TextInput label="Marked text" description="Type it exactly as it is printed." value={text} onChange={setText} hasAutoFocus />
          <RadioList label="What kind of mark is it?" value={type} onChange={(value) => setType(value as ChosenMarkType)}>
            {ADD_TYPES.map((option) => (
              <RadioListItem key={option.type} value={option.type} label={option.label} description={option.description} />
            ))}
          </RadioList>
          <HStack gap={2}>
            <Button label="Add mark" type="submit" variant="primary" isDisabled={busy || !text.trim()} />
            <Button label="Cancel" variant="ghost" onClick={onCancel} />
          </HStack>
        </VStack>
      </form>
    </Card>
  );
}
