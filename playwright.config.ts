import { defineConfig, devices } from '@playwright/test';

/**
 * Responsive checks run against the dev server already on :3000. They only
 * visit pages a signed-out visitor can reach, so no wallet or key is needed.
 *
 * Kept apart from the unit tests (`npm test`, Node's runner) because these
 * need a browser: `npm run test:e2e`.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The iPhone case sets its own viewport; running it here too would
      // check it at desktop size and fail for the wrong reason.
      testIgnore: /iphone\.spec\.ts/,
    },
    {
      // A real device descriptor, so the viewport meta is honoured the way a
      // phone honours it rather than the way --window-size does.
      name: 'iphone',
      use: { ...devices['iPhone 13'] },
      testMatch: /iphone\.spec\.ts/,
    },
  ],
  // Reuses a running dev server rather than starting a second one on a port
  // that is already taken.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
