import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'What Chekmark stores',
    body: 'Your email address, the books and page numbers you add, your page photos, the text you marked with the sentence around it, the explanations made for it, and your review history. Chekmark does not keep the full text of a page.',
  },
  {
    title: 'Your photos',
    body: 'Photos are private to your account. Each one is deleted automatically 30 days after its page is processed, and you can delete it sooner from the page’s results. Deleting a photo keeps your marks, results and word bank.',
  },
  {
    title: 'Who else sees your pages',
    body: 'To read your marks and write explanations, each photo and the marked text are sent to Anthropic’s Claude AI service. Nothing is sold or shared for advertising. Sign-in emails are sent through an email delivery service, which sees your email address.',
  },
  {
    title: 'Signing in',
    body: 'There is no password. A one-time link is emailed to you, and a cookie keeps you signed in on that device for 30 days. The cookie is used only for signing in. There are no tracking or advertising cookies.',
  },
  {
    title: 'The demo',
    body: 'The demo asks for no email. It makes a temporary account with sample pages, kept apart from everyone else’s, and deletes it with everything in it after about 24 hours. Nothing in the demo is sent to Claude.',
  },
  {
    title: 'Deleting everything',
    body: 'Settings has a Delete account button. It removes your account, books, pages, photos, word bank and cards right away, and it cannot be undone.',
  },
  {
    title: 'Books and copyright',
    body: 'Upload pages only from books you are reading for your own study. Chekmark stores only what you marked, and never shares your pages with other readers.',
  },
  {
    title: 'Beta',
    body: 'Chekmark is in beta. It can miss or misread marks, which is why you check every page before anything is saved, and explanations are written by AI and can be wrong.',
  },
];

/** What is stored, for how long and who sees it, in plain words. Open to everyone, signed in or not. */
export function Privacy() {
  return (
    <VStack gap={5}>
      <VStack gap={2} hAlign="start">
        <Heading level={1}>Privacy</Heading>
        <Text type="large" color="secondary" as="p">
          What Chekmark keeps, for how long, and who sees it.
        </Text>
      </VStack>
      {SECTIONS.map((section) => (
        <VStack key={section.title} gap={1}>
          <Heading level={2}>{section.title}</Heading>
          <Text as="p">{section.body}</Text>
        </VStack>
      ))}
      <Link href="/" isStandalone>
        Back to Chekmark
      </Link>
    </VStack>
  );
}
