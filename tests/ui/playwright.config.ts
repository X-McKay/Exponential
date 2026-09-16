import { defineConfig, devices } from "@playwright/test";

// Three ways to point the suite at an application:
//   default        global setup builds nothing, spawns the production server on a temp database (port 3199)
//   E2E_IMAGE=…    global setup runs that container image instead (CONTAINER_ENGINE=docker|podman)
//   E2E_BASE_URL=… an application you started yourself; it must be empty or disposable, the suite seeds it
// A local fixture model provider is started in every mode so document-based flows run without a real model.
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? "3199"}`;

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "report" }]] : [["list"]],
  outputDir: "./results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // A preinstalled browser (PW_CHROMIUM=/path/to/chrome) avoids a download; otherwise Playwright's own Chromium is used.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } }, testIgnore: /responsive\.spec\.ts/ },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: false, hasTouch: true }, testMatch: /responsive\.spec\.ts/ },
  ],
});
