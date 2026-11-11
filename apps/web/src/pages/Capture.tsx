import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { messageOf, useApi } from '../api';
import { preparePhoto } from '../photo';
import { ErrorNote } from '../ui';

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
  const [file, setFile] = useState<File | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preparing' | 'uploading' | null>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function choose(chosen: File | null) {
    setFile(chosen);
    setError(null);
    setPhoto(null);
    setPreview(null);
    if (!chosen) return;
    setBusy('preparing');
    try {
      const prepared = await preparePhoto(chosen);
      setPhoto(prepared);
      setPreview(URL.createObjectURL(prepared));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  const validNumber = /^\d+$/.test(pageNumber) && Number(pageNumber) >= 1;

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!photo || !validNumber) return;
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

  return (
    <form onSubmit={upload}>
      <VStack gap={5}>
        <VStack gap={2} hAlign="start">
          <Link href={`/books/${bookId}`} isStandalone>
            Back to the book
          </Link>
          <Heading level={1}>Add a page</Heading>
        </VStack>

        <TextInput
          label="Page number"
          inputMode="numeric"
          enterKeyHint="next"
          value={pageNumber}
          onChange={setPageNumber}
          width={160}
          status={pageNumber !== '' && !validNumber ? { type: 'error', message: 'Enter the number printed on the page, 1 or more.' } : undefined}
        />

        <FileInput
          label="Photo of the page"
          description="Hold the phone flat over the page, in good light, with the whole page in view."
          placeholder="Take or choose a photo"
          mode="dropzone"
          accept="image/*"
          value={file}
          onChange={(files) => void choose(Array.isArray(files) ? (files[0] ?? null) : files)}
          isLoading={busy === 'preparing'}
          width="100%"
        />
        {preview && <img className="photo-preview" src={preview} alt="The page you are about to upload" />}
        <ErrorNote message={error} />
        <Text type="supporting" as="p">
          The photo is private to you and is deleted after 30 days.
        </Text>

        <div className="action-bar">
          <Button
            label={busy === 'uploading' ? 'Uploading…' : 'Upload page'}
            type="submit"
            variant="primary"
            size="lg"
            width="100%"
            isDisabled={!photo || !validNumber}
            isLoading={busy === 'uploading'}
          />
        </div>
      </VStack>
    </form>
  );
}
