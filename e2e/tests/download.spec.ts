import { test, expect } from '@playwright/test';

test.describe('yt-to-mp3', () => {
  test('page loads with form and format picker', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Download audio from YouTube' })).toBeVisible();
    await expect(page.getByLabel('YouTube link')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'MP3' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio')).toHaveCount(6);
    await expect(page.locator('button[type="submit"]')).toHaveText('Download MP3');
  });

  test('uses the SVG favicon', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg');
    const res = await request.get('/favicon.svg');
    expect(res.ok()).toBeTruthy();
  });

  test('selected format updates the button and survives a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('radio', { name: 'FLAC' }).click();
    await expect(page.locator('button[type="submit"]')).toHaveText('Download FLAC');
    await expect(page).toHaveURL(/format=flac/);

    await page.reload();
    await expect(page.getByRole('radio', { name: 'FLAC' })).toHaveAttribute('aria-checked', 'true');
  });

  test('shows error for invalid URL', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('YouTube link').fill('not-a-valid-url');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('alert')).toContainText('Invalid URL');
  });

  test('rejects non-YouTube URLs', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('YouTube link').fill('https://example.com/video');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('alert')).toContainText('Only YouTube URLs are supported');
  });

  test('playlist-only links are refused (playlists disabled)', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('YouTube link').fill('https://www.youtube.com/playlist?list=PL123');
    await expect(page.getByText('This is a playlist link.')).toBeVisible();
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('alert')).toContainText('Playlist downloads are disabled');

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('video link inside a playlist only downloads the video', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('YouTube link').fill('https://www.youtube.com/watch?v=abc&list=PL123');
    await expect(page.getByText('only this video will be downloaded')).toBeVisible();
  });

  test('button is disabled when input is empty', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });

  // Hits YouTube for real: excluded in CI (`--grep-invert @network`) because runner IPs are often blocked.
  test('downloads MP3 for a valid YouTube URL', { tag: '@network' }, async ({ page }) => {
    await page.goto('/');
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByLabel('YouTube link').fill('https://www.youtube.com/watch?v=VCuS3enPwKI');
    await page.locator('button[type="submit"]').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.mp3$/i);
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  });

  test('downloads the chosen format (Opus) from a playlist video link', { tag: '@network' }, async ({ page }) => {
    await page.goto('/?format=opus');
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByLabel('YouTube link').fill('https://www.youtube.com/watch?v=VCuS3enPwKI&list=RDVCuS3enPwKI');
    await page.locator('button[type="submit"]').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.opus$/i);
  });
});
