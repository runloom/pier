import { describe, expect, it } from "vitest";
import { shouldBypassQuitConfirmationForTests } from "../../../src/main/app-quit/quit-test-runtime.ts";

describe("shouldBypassQuitConfirmationForTests", () => {
  it.each([
    { name: "empty env", env: {}, expected: false },
    {
      name: "explicit Pier test bypass enabled",
      env: { PIER_TEST_DISABLE_QUIT_CONFIRMATION: "1" },
      expected: true,
    },
    {
      name: "explicit Pier test bypass disabled",
      env: { PIER_TEST_DISABLE_QUIT_CONFIRMATION: "0" },
      expected: false,
    },
    {
      name: "Playwright test runtime enabled",
      env: { PLAYWRIGHT_TEST: "1" },
      expected: true,
    },
    {
      name: "Vitest runtime enabled",
      env: { VITEST: "true" },
      expected: true,
    },
    {
      name: "unsupported Vitest numeric flag",
      env: { VITEST: "1" },
      expected: false,
    },
  ] as const)("returns $expected for $name", ({ env, expected }) => {
    expect(shouldBypassQuitConfirmationForTests(env)).toBe(expected);
  });
});
