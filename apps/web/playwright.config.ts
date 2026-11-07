import { defineConfig, devices } from "@playwright/test";

/**
 * T004 — E2E với camera và vị trí giả lập.
 * Camera giả dùng video Y4M trong tests/fixtures/ (thêm ở Phase 5).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    permissions: ["camera", "geolocation"],
    geolocation: { latitude: 21.0278, longitude: 105.8019, accuracy: 15 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
        launchOptions: {
          args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
        },
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
