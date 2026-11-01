import { defineConfig, devices } from '@playwright/test'
const port = 47519
export default defineConfig({
  testDir: './e2e-offline',
  testMatch: '**/*.e2e.ts',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/offline-report.json' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, serviceWorkers: 'allow', screenshot: 'only-on-failure' },
  projects: [{ name: 'real-chrome-offline', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port} --strictPort --outDir ../dist-offline`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
})
