import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useNavigate, useSearchParams } from 'react-router';
import { messageOf, type RequestLinkAnswer, type User, useApi } from '../api';
import { ErrorNote } from '../ui';

/** The three kinds of mark, drawn the way the reader draws them. This is the whole idea of the app, so it is the first thing shown. */
function HowItWorks() {
  return (
    <VStack gap={3}>
      <Heading level={2}>Three marks, three results</Heading>
      <ul className="legend">
        <li className="mark-underline_save">
          <span className="mark-text" lang="ko">
            끄트머리
          </span>
          <Text type="supporting">Underline a word or phrase: its meaning here, saved as a study card.</Text>
        </li>
        <li className="mark-curly">
          <span className="mark-text" lang="ko">
            비록 -지만
          </span>
          <Text type="supporting">Draw a wavy line under grammar: how the pattern works, saved as a card.</Text>
        </li>
        <li className="mark-underline_translate">
          <span className="mark-text" lang="ko">
            너무나 기뻤다.
          </span>
          <Text type="supporting">Underline a whole sentence: a translation, not saved.</Text>
        </li>
      </ul>
    </VStack>
  );
}

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
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [startingDemo, setStartingDemo] = useState(false);

  useEffect(() => {
    api.demoEnabled().then(setDemoEnabled, () => undefined); // without an answer there is simply no demo button
  }, [api]);

  async function startDemo() {
    setStartingDemo(true);
    setError(null);
    try {
      const user = await api.startDemo();
      onSignedIn(user);
      navigate('/', { replace: true });
    } catch (e) {
      setError(messageOf(e));
      setStartingDemo(false);
    }
  }

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
    if (!email.trim()) return;
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

  if (token && !error) return <Spinner size="lg" label="Signing you in…" />;

  const again = <Button label="Use a different email" variant="ghost" onClick={() => setSent(null)} />;

  // Only on a developer's own machine with no email service: the server hands the link back.
  if (sent?.dev && 'link' in sent.dev) {
    const url = new URL(sent.dev.link);
    return (
      <VStack gap={4} hAlign="start">
        <Heading level={1}>Your sign-in link</Heading>
        <Text type="large" color="secondary" as="p">
          No email service is set up on this computer, so nothing was emailed. Use the link here instead. It works once, for 15 minutes.
        </Text>
        <Button label="Sign in with this link" variant="primary" size="lg" width="100%" href={`${url.pathname}${url.search}`} />
        {again}
      </VStack>
    );
  }

  if (sent?.dev && 'notAllowed' in sent.dev) {
    return (
      <VStack gap={4} hAlign="start">
        <Heading level={1}>This address cannot sign in</Heading>
        <Text type="large" color="secondary" as="p">
          <strong>{email.trim()}</strong> is not on the allowed list. Add it to <code>ALLOWED_EMAILS</code> in the <code>.env</code> file and restart the
          API, or set <code>SIGN_UP=open</code> to let any address sign in.
        </Text>
        {again}
      </VStack>
    );
  }

  if (sent) {
    return (
      <VStack gap={4} hAlign="start">
        <Heading level={1}>Check your email</Heading>
        <Text type="large" color="secondary" as="p">
          If <strong>{email.trim()}</strong> can sign in, a link is on its way. It works once, for 15 minutes.
        </Text>
        <Text type="supporting" as="p">
          Nothing after a minute or two? Look in your spam folder, then ask for a new link.
        </Text>
        {again}
      </VStack>
    );
  }

  return (
    <VStack gap={8}>
      <VStack gap={3}>
        <Heading level={1} type="display-3">
          Read with a pencil. Study what you marked.
        </Heading>
        <Text type="large" color="secondary" as="p">
          Mark a page of your Korean book, take a photo, and get an explanation and a study card for every mark.
        </Text>
      </VStack>
      <form onSubmit={submit} noValidate>
        <VStack gap={4}>
          <TextInput label="Email" type="email" size="lg" autoComplete="email" inputMode="email" autoCapitalize="off" value={email} onChange={setEmail} />
          <ErrorNote message={error} />
          <Button label="Email me a sign-in link" type="submit" variant="primary" size="lg" width="100%" isLoading={busy} />
          <Text type="supporting" as="p">
            No password. Chekmark is in beta: it can miss or misread marks, so you check each page before anything is saved.
          </Text>
        </VStack>
      </form>
      {demoEnabled && (
        <VStack gap={2}>
          <Button label="Try the demo" variant="secondary" size="lg" width="100%" isLoading={startingDemo} onClick={() => void startDemo()} />
          <Text type="supporting" as="p">
            No email needed. You get sample pages in your own temporary account, which is deleted after 24 hours.
          </Text>
        </VStack>
      )}
      <HowItWorks />
    </VStack>
  );
}
