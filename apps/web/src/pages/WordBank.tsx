import { type FormEvent, useEffect, useRef, useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useNavigate, useParams } from 'react-router';
import { type ItemDetail, type ItemKind, type ItemSummary, messageOf, type Sense, useApi } from '../api';
import { ErrorNote } from '../ui';

/** Every saved word and grammar pattern, newest first, searchable by form or meaning. */
export function WordBank() {
  const api = useApi();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | ItemKind>('all');
  const [items, setItems] = useState<ItemSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current; // only the newest search may update the list
    api.listItems({ q, kind: kind === 'all' ? undefined : kind }).then(
      (found) => request === latest.current && setItems(found),
      (e: unknown) => request === latest.current && setError(messageOf(e)),
    );
  }, [api, q, kind]);

  const filtering = q.trim() !== '' || kind !== 'all';

  return (
    <VStack gap={4}>
      <Heading level={1}>Word bank</Heading>
      <TextInput label="Search your word bank" isLabelHidden type="search" placeholder="Search by word or meaning" value={q} onChange={setQ} hasClear />
      <SegmentedControl label="Show" value={kind} onChange={(value) => setKind(value as 'all' | ItemKind)}>
        <SegmentedControlItem value="all" label="All" />
        <SegmentedControlItem value="word" label="Words" />
        <SegmentedControlItem value="grammar" label="Grammar" />
      </SegmentedControl>
      <ErrorNote message={error} />
      {!items && !error && (
        <VStack gap={2} aria-label="Loading">
          <Skeleton height={56} />
          <Skeleton height={56} index={1} />
        </VStack>
      )}
      {items?.length === 0 && (
        <Text type="large" color="secondary" as="p">
          {filtering ? 'Nothing matches that search.' : 'Words and grammar you mark will appear here after you confirm a page.'}
        </Text>
      )}
      {items && items.length > 0 && (
        <List hasDividers edge="flush" density="spacious">
          {items.map((item) => (
            <ListItem
              key={item.id}
              href={`/wordbank/${item.id}`}
              label={
                <Text type="large">
                  <span className="korean" lang="ko">
                    {item.normalForm}
                  </span>
                </Text>
              }
              description={item.meanings.join('; ')}
            />
          ))}
        </List>
      )}
    </VStack>
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
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getItem(itemId).then(setItem, (e: unknown) => setError(messageOf(e)));
  }, [api, itemId]);

  async function remove() {
    setError(null);
    setDeleting(true);
    try {
      await api.deleteItem(itemId);
      navigate('/wordbank', { replace: true });
    } catch (e) {
      setConfirming(false);
      setDeleting(false);
      setError(messageOf(e));
    }
  }

  if (!item) {
    return error ? (
      <VStack gap={3} hAlign="start">
        <ErrorNote message={error} />
        <Link href="/wordbank" isStandalone>
          Back to the word bank
        </Link>
      </VStack>
    ) : (
      <Skeleton height={160} />
    );
  }

  const cards = item.senses.length;
  return (
    <VStack gap={5}>
      <VStack gap={2} hAlign="start">
        <Link href="/wordbank" isStandalone>
          Word bank
        </Link>
        <Heading level={1}>
          <span className="korean" lang="ko">
            {item.normalForm}
          </span>
        </Heading>
        <Text type="supporting">{item.kind === 'word' ? 'Word' : 'Grammar'}</Text>
      </VStack>

      {item.senses.map((sense, index) => (
        <VStack key={sense.id} gap={4}>
          {item.senses.length > 1 && <Heading level={2}>Meaning {index + 1}</Heading>}
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
            <VStack gap={2} hAlign="start">
              <Text type="large" weight="medium" as="p">
                {sense.meaning}
              </Text>
              {sense.notes && (
                <Text color="secondary" as="p">
                  {sense.notes}
                </Text>
              )}
              {sense.example && (
                <VStack gap={0.5}>
                  <Text as="p">
                    <span className="korean" lang="ko">
                      {sense.example}
                    </span>
                  </Text>
                  {sense.exampleTranslation && (
                    <Text color="secondary" as="p">
                      {sense.exampleTranslation}
                    </Text>
                  )}
                </VStack>
              )}
              <Button label="Edit meaning" variant="ghost" size="sm" onClick={() => setEditing(sense.id)} />
            </VStack>
          )}
          <VStack gap={2}>
            <Heading level={3}>Where you met it</Heading>
            {sense.sightings.map((sighting) => (
              <VStack key={sighting.id} gap={0.5} hAlign="start">
                <Text as="p">
                  <span className="korean" lang="ko">
                    {sighting.sentence}
                  </span>
                </Text>
                {sighting.sentenceTranslation && (
                  <Text color="secondary" as="p">
                    {sighting.sentenceTranslation}
                  </Text>
                )}
                <Link href={`/pages/${sighting.pageId}`}>
                  {sighting.bookTitle}, page {sighting.pageNumber}
                </Link>
              </VStack>
            ))}
          </VStack>
        </VStack>
      ))}

      <ErrorNote message={error} />
      <Divider />
      <HStack>
        <Button label="Delete from word bank" variant="ghost" size="sm" onClick={() => setConfirming(true)} />
      </HStack>
      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${item.normalForm}?`}
        description={`This deletes its meanings, the places you met it, and its ${cards} card${cards === 1 ? '' : 's'}. It cannot be undone. Your pages and their results stay.`}
        actionLabel={`Delete ${item.normalForm}`}
        cancelLabel="Keep it"
        isActionLoading={deleting}
        onAction={() => void remove()}
      />
    </VStack>
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
    <Card>
      <form onSubmit={submit}>
        <VStack gap={4}>
          <TextInput label="Meaning" value={meaning} onChange={setMeaning} hasAutoFocus />
          <TextInput label="Note" isOptional value={notes} onChange={setNotes} />
          <HStack gap={2}>
            <Button label="Save" type="submit" variant="primary" isDisabled={!meaning.trim()} />
            <Button label="Cancel" variant="ghost" onClick={onCancel} />
          </HStack>
        </VStack>
      </form>
    </Card>
  );
}
