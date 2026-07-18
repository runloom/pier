import { afterEach, describe, expect, it } from "vitest";
import {
  armDetaching,
  disarmDetaching,
  isWindowDetaching,
} from "../../../src/main/services/agents/window-detaching-guard.ts";
import { isSuspendedJobExitCode } from "../../../src/main/services/foreground-activity/entry.ts";

describe("window-detaching-guard", () => {
  afterEach(() => {
    disarmDetaching({ electronWindowId: "7", recordId: "main" });
    disarmDetaching({ electronWindowId: "42", recordId: "session-main" });
  });

  it("arms both electron id and recordId", () => {
    armDetaching({ electronWindowId: "7", recordId: "main" });
    expect(isWindowDetaching("7")).toBe(true);
    expect(isWindowDetaching("main")).toBe(true);
    expect(isWindowDetaching("other")).toBe(false);
    disarmDetaching({ electronWindowId: "7", recordId: "main" });
    expect(isWindowDetaching("7")).toBe(false);
    expect(isWindowDetaching("main")).toBe(false);
  });

  it("ignores empty keys", () => {
    armDetaching({ electronWindowId: "", recordId: "" });
    expect(isWindowDetaching("")).toBe(false);
  });
});

describe("isSuspendedJobExitCode", () => {
  it("recognizes suspended job exit codes", () => {
    expect(isSuspendedJobExitCode(145)).toBe(true);
    expect(isSuspendedJobExitCode(146)).toBe(true);
    expect(isSuspendedJobExitCode(147)).toBe(true);
    expect(isSuspendedJobExitCode(148)).toBe(true);
  });

  it("rejects normal and missing exit codes", () => {
    expect(isSuspendedJobExitCode(0)).toBe(false);
    expect(isSuspendedJobExitCode(1)).toBe(false);
    expect(isSuspendedJobExitCode(undefined)).toBe(false);
  });
});
