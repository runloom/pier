import { defineConfig } from "@playwright/test";

process.env.PIER_TEST_DISABLE_QUIT_CONFIRMATION = "1";

// Pier main 进程使用 worktree-specific userData (dev-profile.mjs 派的固定路径).
// 多个 electron.launch 并发会触发 chromium SingletonLock 冲突, 必须串行。
export default defineConfig({
  testDir: "./tests",
  testMatch: /(e2e)\/.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
});
