import { test, expect, devices } from '@playwright/test';

/**
 * Responsive checks that measure the DOM rather than look at a picture.
 *
 * Headless screenshots were misleading here: `--window-size` does not apply
 * the viewport meta the way a real device does, so two runs either side of a
 * genuine fix produced byte-identical images. Asking the page for its own
 * scrollWidth is the thing that actually answers "does this overflow".
 */

const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 360, height: 800 };
const TABLET = { width: 768, height: 1024 };
const LAPTOP = { width: 1024, height: 768 };
const DESKTOP = { width: 1440, height: 900 };

/** Every page a signed-out visitor can reach. */
const PAGES = ['/', '/app'];

for (const size of [SMALL_PHONE, PHONE, TABLET, LAPTOP, DESKTOP]) {
  for (const path of PAGES) {
    test(`no horizontal overflow at ${size.width}px on ${path}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(path, { waitUntil: 'networkidle' });

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      // A couple of pixels of rounding is tolerable; a scrollbar's worth is not.
      expect(scrollWidth, `page scrolls sideways at ${size.width}px`).toBeLessThanOrEqual(
        clientWidth + 2,
      );
    });
  }
}

test('the viewport meta is present, or every phone layout is wrong', async ({ page }) => {
  await page.goto('/');
  const content = await page.getAttribute('meta[name="viewport"]', 'content');
  expect(content).toContain('width=device-width');
  // Required for env(safe-area-inset-*) to resolve on a notched phone, which
  // the bottom tab bar depends on.
  expect(content).toContain('viewport-fit=cover');
});

test('the workspace tabs sit at the bottom on a phone', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/app', { waitUntil: 'networkidle' });

  const tabs = page.locator('.workspace-tabs');
  if ((await tabs.count()) === 0) {
    test.skip(true, 'tabs render only once signed in');
    return;
  }
  const position = await tabs.evaluate((el) => getComputedStyle(el).position);
  expect(position).toBe('fixed');
});

test('the workspace tabs stay at the top on a laptop', async ({ page }) => {
  await page.setViewportSize(LAPTOP);
  await page.goto('/app', { waitUntil: 'networkidle' });

  const tabs = page.locator('.workspace-tabs');
  if ((await tabs.count()) === 0) {
    test.skip(true, 'tabs render only once signed in');
    return;
  }
  const position = await tabs.evaluate((el) => getComputedStyle(el).position);
  expect(position).not.toBe('fixed');
});

test('nav collapses to a menu button before it would clip', async ({ page }) => {
  // Between 600px and 860px the four links plus the wallet action were wider
  // than the header, and "Wallet" was cut off the right edge.
  await page.setViewportSize(TABLET);
  await page.goto('/', { waitUntil: 'networkidle' });

  const toggle = page.locator('.menu-toggle');
  await expect(toggle).toBeVisible();

  const header = page.locator('.site-header-inner');
  const overflows = await header.evaluate((el) => el.scrollWidth > el.clientWidth + 2);
  expect(overflows, 'header content is wider than the header').toBe(false);
});

test('tap targets on a phone are big enough to hit', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/', { waitUntil: 'networkidle' });

  // 44px is the usual minimum; a few pixels under is still reachable, so the
  // bar is set where a target becomes genuinely fiddly.
  const tooSmall = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll('a, button')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue; // hidden
      // The skip-link is parked off-screen until focused, by design.
      if (el.classList.contains('skip-link')) continue;
      // Anything scrolled out of view is not a target the thumb can reach now.
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      if (rect.height < 36) {
        bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} h=${Math.round(rect.height)}`);
      }
    }
    return bad;
  });
  expect(tooSmall, `targets shorter than 36px: ${tooSmall.join(', ')}`).toHaveLength(0);
});

test('inputs are at least 16px so iOS does not zoom on focus', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/app', { waitUntil: 'networkidle' });

  const small = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll('input, select, textarea')) {
      const type = el.getAttribute('type');
      if (type === 'checkbox' || type === 'radio') continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) bad.push(`${el.tagName.toLowerCase()} ${size}px`);
    }
    return bad;
  });
  expect(small, `inputs under 16px: ${small.join(', ')}`).toHaveLength(0);
});
