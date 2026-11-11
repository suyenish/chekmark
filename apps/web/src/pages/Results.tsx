import { useEffect, useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Link } from '@astryxdesign/core/Link';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { messageOf, type PageInfo, type PageResult, useApi } from '../api';
import { ErrorNote } from '../ui';

const KIND_LABEL = { word: 'Word', grammar: 'Grammar', translation: 'Translation' } as const;
const MARK_CLASS = { word: 'mark-underline_save', grammar: 'mark-curly', translation: 'mark-underline_translate' } as const;

/** Korean on one line, its English under it. */
function Pair({ label, korean, english }: { label: string; korean: string; english: string | null }) {
  return (
    <VStack gap={0.5}>
      <Text type="supporting">{label}</Text>
      <Text as="p">
        <span className="korean" lang="ko">
          {korean}
        </span>
      </Text>
      {english && (
        <Text color="secondary" as="p">
          {english}
        </Text>
      )}
    </VStack>
  );
}

/** A finished page: one entry per mark, in the order the marks are on the page. */
export function Results({ page, onPhotoDeleted }: { page: PageInfo; onPhotoDeleted: () => void }) {
  const api = useApi();
  const [results, setResults] = useState<PageResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.pageResults(page.id).then(setResults, (e: unknown) => setError(messageOf(e)));
  }, [api, page.id]);

  if (!results) {
    return error ? (
      <ErrorNote message={error} />
    ) : (
      <VStack gap={3} aria-label="Loading results">
        <Skeleton height={40} width="50%" />
        <Skeleton height={120} index={1} />
        <Skeleton height={120} index={2} />
      </VStack>
    );
  }

  const saved = results.filter((result) => result.kind !== 'translation').length;

  return (
    <VStack gap={5}>
      <VStack gap={2} hAlign="start">
        <Link href={`/books/${page.bookId}`} isStandalone>
          Back to the book
        </Link>
        <Heading level={1}>Page {page.pageNumber}</Heading>
        <Text type="large" color="secondary" as="p">
          {results.length === 0
            ? 'There was nothing to explain on this page.'
            : saved > 0
              ? `${saved} word${saved === 1 ? '' : 's'} and grammar point${saved === 1 ? '' : 's'} saved to your word bank.`
              : 'Translations only: nothing was saved to your word bank.'}
        </Text>
        {saved > 0 && <Button label="Review your cards" href="/review" />}
      </VStack>

      {results.map((result) => (
        <VStack key={result.markId} gap={3}>
          <Divider />
          <article className={MARK_CLASS[result.kind]}>
            <VStack gap={3}>
              <VStack gap={0.5}>
                <span className="mark-text" data-testid="marked" lang="ko">
                  {result.text}
                </span>
                <Text type="supporting">{KIND_LABEL[result.kind]}</Text>
              </VStack>
              {result.kind === 'translation' ? (
                <Text type="large" as="p">
                  {result.translation}
                </Text>
              ) : (
                <>
                  <VStack gap={1}>
                    <Text type="large" weight="bold" as="p">
                      <span className="korean" lang="ko">
                        {result.normalForm}
                      </span>
                    </Text>
                    <Text type="large" weight="medium" as="p">
                      {result.meaning}
                    </Text>
                    {result.notes && (
                      <Text color="secondary" as="p">
                        {result.notes}
                      </Text>
                    )}
                  </VStack>
                  <Pair label="In your book" korean={result.sentence} english={result.sentenceTranslation} />
                  {result.example && <Pair label="Example" korean={result.example} english={result.exampleTranslation} />}
                  {result.seenBefore.map((seen) => (
                    <aside key={seen.pageId + seen.sentence} className="seen-before">
                      <VStack gap={0.5}>
                        <Text type="label" as="p">
                          You saw this on page {seen.pageNumber}
                          {seen.bookId !== page.bookId ? ` of ${seen.bookTitle}` : ''}.
                        </Text>
                        <Text as="p">
                          <span className="korean" lang="ko">
                            {seen.sentence}
                          </span>
                        </Text>
                      </VStack>
                    </aside>
                  ))}
                  <HStack>
                    <Link href={`/wordbank/${result.itemId}`}>Open in word bank</Link>
                  </HStack>
                </>
              )}
            </VStack>
          </article>
        </VStack>
      ))}

      {page.hasPhoto && <DeletePhoto pageId={page.id} onDeleted={onPhotoDeleted} />}
    </VStack>
  );
}

/** Photos are deleted after 30 days anyway; this does it now. */
function DeletePhoto({ pageId, onDeleted }: { pageId: string; onDeleted: () => void }) {
  const api = useApi();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await api.deletePagePhoto(pageId);
      setAsking(false);
      onDeleted();
    } catch (e) {
      setAsking(false);
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap={3} hAlign="start">
      <Divider />
      <Text type="supporting" as="p">
        Your photo of this page is private and is deleted after 30 days.
      </Text>
      <Button label="Delete photo" variant="ghost" size="sm" onClick={() => setAsking(true)} />
      <ErrorNote message={error} />
      <AlertDialog
        isOpen={asking}
        onOpenChange={setAsking}
        title="Delete this photo now?"
        description="The photo is deleted now instead of after 30 days. These results and your word bank stay."
        actionLabel="Delete the photo"
        cancelLabel="Keep it"
        isActionLoading={busy}
        onAction={() => void remove()}
      />
    </VStack>
  );
}
