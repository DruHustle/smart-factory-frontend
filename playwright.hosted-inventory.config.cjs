const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: path.join(__dirname, 'scripts/qualification'),
  testMatch: 'hosted-inventory.spec.cjs',
  outputDir: path.join(process.env.RUNNER_TEMP || '/tmp', 'hosted-inventory-artifacts'),
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 5000 },
  reporter: [[path.join(__dirname, 'scripts/qualification/hosted-inventory-reporter.cjs')]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.EXPERIENCE_E2E_BASE_URL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
});
