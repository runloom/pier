import {
  FALLBACK_TIMEOUT_FLOOR_MS,
  fallbackTimeoutMs,
  parseShellEnvironmentOutput,
  remainingTimeoutMs,
  SHELL_ENV_END,
  SHELL_ENV_START,
  tryParseShellEnvironmentOutput,
} from "@main/services/process-environment/shell-env-loader.ts";
import { describe, expect, it } from "vitest";

describe("remainingTimeoutMs", () => {
  it("returns remaining budget until shared deadline", () => {
    const deadline = 1_000_000;
    expect(remainingTimeoutMs(deadline, 999_000)).toBe(1000);
    expect(remainingTimeoutMs(deadline, 1_000_000)).toBe(1);
    expect(remainingTimeoutMs(deadline, 1_000_500)).toBe(1);
  });
});

describe("fallbackTimeoutMs", () => {
  it("uses remaining budget when primary failed quickly", () => {
    const deadline = 1_000_000;
    expect(fallbackTimeoutMs(deadline, 10_000, 995_000)).toBe(5000);
  });

  it("uses floor when primary exhausted the shared deadline", () => {
    const deadline = 1_000_000;
    expect(fallbackTimeoutMs(deadline, 10_000, 1_000_000)).toBe(
      FALLBACK_TIMEOUT_FLOOR_MS
    );
    expect(fallbackTimeoutMs(deadline, 10_000, 999_600)).toBe(
      FALLBACK_TIMEOUT_FLOOR_MS
    );
  });

  it("never exceeds the configured total timeout for the floor", () => {
    expect(fallbackTimeoutMs(1_000_000, 1500, 1_000_000)).toBe(1500);
  });
});

describe("tryParseShellEnvironmentOutput", () => {
  it("parses a valid dump buffer", () => {
    const buf = Buffer.from(
      `${SHELL_ENV_START}\nPATH=/bin\0HOME=/tmp\n${SHELL_ENV_END}\n`
    );
    expect(tryParseShellEnvironmentOutput(buf)).toEqual({
      HOME: "/tmp",
      PATH: "/bin",
    });
    expect(parseShellEnvironmentOutput(buf)).toEqual({
      HOME: "/tmp",
      PATH: "/bin",
    });
  });

  it("returns null when markers are missing (does not throw)", () => {
    expect(
      tryParseShellEnvironmentOutput(Buffer.from("no markers"))
    ).toBeNull();
  });
});
