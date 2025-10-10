const path = require("node:path");
const { defineConfig } = require("@playwright/test");

const baseURL = process.env.PORTAL_VISUAL_BASE_URL ?? "http://127.0.0.1:4300";
const testDirectory = path.join(__dirname, "tests/visual");

console.info(`[playwright] using testDir=${testDirectory}`);

module.exports = defineConfig({
  testDir: testDirectory,
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
    colorScheme: "light",
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
    screenshot: "off",
    video: "off",
    trace: "off",
  },
  webServer: {
    command: process.env.PORTAL_VISUAL_COMMAND ?? "pnpm run dev:visual",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  },
});
