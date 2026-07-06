import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.RAG_E2E_BASE_URL || "http://127.0.0.1:3021";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: process.env.RAG_E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start -- -p 3021",
        url: `${baseURL}/rag`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
