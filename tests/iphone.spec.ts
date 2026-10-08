import { test, expect } from '@playwright/test';

/**
 * Runs only under the "iphone" project, which supplies a real device
 * descriptor. Kept in its own file because Playwright applies a device per
 * project, not per describe block.
 */
test('a real iPhone profile renders without sideways scroll', async ({ page }) => {
  // Runs under the "iphone" project in playwright.config.ts, which carries
  // the device descriptor; a device cannot be switched inside a describe.
  await page.goto('/', { waitUntil: 'networkidle' });
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
});
