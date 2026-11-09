import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const EMAIL = 'e2e@example.com';
const PHOTO = path.join(__dirname, 'fixtures/page.jpg');

const usedLinks = new Set<string>();

/**
 * In this stack there is no email server: the api prints the sign-in link in
 * its log. Wait for a link for EMAIL that this test has not used yet.
 */
async function signInLink(after: Date): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const since = new Date(after.getTime() - 5000).toISOString();
    const logs = execFileSync('docker', ['compose', '--profile', 'app', 'logs', 'api', '--no-color', '--since', since], { encoding: 'utf8' })
      // The api colours its own log lines; remove the colour codes around the link.
      .replace(/\u001b\[[0-9;]*m/g, '');
    const fresh = [...logs.matchAll(new RegExp(`Sign-in link for ${EMAIL}: (\\S+)`, 'g'))].map((m) => m[1]).filter((link) => !usedLinks.has(link));
    if (fresh.length) {
      usedLinks.add(fresh.at(-1)!);
      return fresh.at(-1)!;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('No new sign-in link appeared in the api log');
}

async function signIn(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in/);
  const requestedAt = new Date();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto(await signInLink(requestedAt));
  await expect(page.getByRole('heading', { name: 'Your books' })).toBeVisible();
}

/** Starts every run from an empty account, even after a run that stopped half-way. */
async function deleteAccount(page: Page) {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('button', { name: 'Delete my account and all my data' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

async function uploadPage(page: Page, pageNumber: number) {
  await page.getByRole('link', { name: 'Add a page' }).click();
  await page.getByLabel('Page number').fill(String(pageNumber));
  await page.locator('input[type=file]').setInputFiles(PHOTO);
  await expect(page.getByRole('img', { name: 'The page you are about to upload' })).toBeVisible();
  await page.getByRole('button', { name: 'Upload page' }).click();
  await expect(page.getByRole('heading', { name: 'Check your marks' })).toBeVisible();
}

test('full journey with the fake AI client', async ({ page }) => {
  await signIn(page);
  await deleteAccount(page);
  await signIn(page);

  // Create a book and upload a page.
  await page.getByLabel('Title').fill('아몬드');
  await page.getByRole('button', { name: 'Add book' }).click();
  await page.getByRole('link', { name: /아몬드/ }).click();
  await uploadPage(page, 12);

  // Resolve the unclear mark, then confirm.
  const confirm = page.getByRole('button', { name: 'Confirm marks' });
  await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: /평평/ }).click();
  await page.getByRole('button', { name: 'Underline' }).click();
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // All three result kinds, in mark order.
  await expect(page.getByRole('heading', { name: 'Page 12' })).toBeVisible();
  const results = page.getByRole('article');
  await expect(results).toHaveCount(4);
  await expect(results.nth(0)).toContainText('Word');
  await expect(results.nth(0)).toContainText('practice meaning of 가까스로');
  await expect(results.nth(2)).toContainText('Translation');
  await expect(results.nth(2)).toContainText('Practice translation of 너무나 기뻤다.');
  await expect(results.nth(3)).toContainText('Grammar');
  await expect(results.nth(3)).toContainText('비록 -지만');

  // Review one card as Easy.
  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page.getByText('3 left')).toBeVisible();
  await expect(page.getByTestId('front').locator('mark')).toBeVisible();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: 'Easy' }).click();
  await expect(page.getByText('2 left')).toBeVisible();

  // A second page that repeats the word: the results remember the first page.
  await page.getByRole('link', { name: 'Books' }).click();
  await page.getByRole('link', { name: /아몬드/ }).click();
  await uploadPage(page, 40);
  await page.getByRole('button', { name: /평평/ }).click();
  await page.getByRole('button', { name: 'Remove mark' }).click();
  await page.getByRole('button', { name: 'Confirm marks' }).click();
  await expect(page.getByRole('heading', { name: 'Page 40' })).toBeVisible();
  await expect(page.getByRole('article').first()).toContainText('You saw this on page 12');

  // Leave nothing behind.
  await deleteAccount(page);
});
