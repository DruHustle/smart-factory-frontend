import {defineConfig,devices} from '@playwright/test';
// Cold Vite workspace preparation shares the runner with automatic software-GPU
// previews. Keep visibility checks bounded without treating the default 5 seconds
// as a model-loading or navigation performance assertion.
export default defineConfig({testDir:'e2e',testMatch:['assistant.spec.ts','infrastructure.spec.ts','design-system.spec.ts'],outputDir:'test-results/visual-workspaces',workers:1,retries:0,reporter:'list',timeout:60000,expect:{timeout:15000},use:{...devices['Desktop Chrome'],baseURL:process.env.PUBLIC_DEMO_E2E_BASE_URL??'http://127.0.0.1:3126',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}}});
