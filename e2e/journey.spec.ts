import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const EMAIL = `e2e-${Date.now()}@example.com`;
const PHOTO = path.join(__dirname, 'fixtures/page.jpg');

/**
 * The local stack has no email service, so the sign-in screen shows the link
 * itself. A new address each run keeps runs apart from each other.
 */
async function signIn(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.getByRole('link', { name: 'Sign in with this link' }).click();
  await expect(page.getByRole('heading', { name: 'Your books' })).toBeVisible();
}

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
