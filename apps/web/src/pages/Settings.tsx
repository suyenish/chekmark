import { useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { messageOf, useApi } from '../api';
import { ErrorNote } from '../ui';

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
      setConfirming(false);
      setError(messageOf(e));
      setBusy(false);
    }
  }

  return (
    <VStack gap={5}>
      <Heading level={1}>Settings</Heading>

      <VStack gap={1}>
        <Heading level={2}>Account</Heading>
        <Text as="p">
          Signed in as <strong>{email}</strong>
        </Text>
      </VStack>

      <VStack gap={2} hAlign="start">
        <Heading level={2}>Your photos and data</Heading>
        <Text color="secondary" as="p">
          Page photos are private and are deleted 30 days after a page is processed. You can delete one sooner from its results page. Your marks, results and
          word bank are kept until you delete them.
        </Text>
        <Link href="/privacy">Privacy: what Chekmark stores and who sees it</Link>
      </VStack>

      <Divider />
      <VStack gap={2} hAlign="start">
        <Heading level={2}>Delete account</Heading>
        <Text color="secondary" as="p">
          Deletes your account, every book and page, every photo, your word bank and your cards.
        </Text>
        <Button label="Delete account" variant="destructive" onClick={() => setConfirming(true)} />
        <ErrorNote message={error} />
      </VStack>

      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Delete your account?"
        description="This deletes your account, every book and page, every photo, your word bank and your cards. It cannot be undone."
        actionLabel="Delete my account and all my data"
        cancelLabel="Keep my account"
        isActionLoading={busy}
        onAction={() => void remove()}
      />
    </VStack>
  );
}
