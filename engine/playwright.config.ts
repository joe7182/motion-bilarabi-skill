import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/browser',
  // Goldens: tests/browser/__screenshots__/<name>-<platform>.png (font rasterisation differs per OS).
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}-{platform}{ext}',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5199' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } }],
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
