import { describe, expect, it, vi } from "vitest";
import {
  isAbsoluteOpenPath,
  openPathWithOpener,
} from "../../../src/main/services/file-open-path.ts";

describe("isAbsoluteOpenPath", () => {
  it("accepts posix and windows absolute paths", () => {
    expect(isAbsoluteOpenPath("/Users/x/file.md")).toBe(true);
    expect(isAbsoluteOpenPath("C:\\Users\\x\\file.md")).toBe(true);
  });

  it("rejects relative and empty", () => {
    expect(isAbsoluteOpenPath("docs/a.md")).toBe(false);
    expect(isAbsoluteOpenPath("")).toBe(false);
    expect(isAbsoluteOpenPath("  ")).toBe(false);
  });
});

describe("openPathWithOpener", () => {
  it("returns invalid-path for relative input without calling opener", async () => {
    const openPath = vi.fn(async () => "");
    await expect(openPathWithOpener("docs/a.md", openPath)).resolves.toEqual({
      opened: false,
      reason: "invalid-path",
    });
    expect(openPath).not.toHaveBeenCalled();
  });

  it("maps empty electron error string to opened:true", async () => {
    const openPath = vi.fn(async () => "");
    await expect(openPathWithOpener("/tmp/a.md", openPath)).resolves.toEqual({
      opened: true,
    });
  });

  it("maps non-empty electron error string to open-failed", async () => {
    const openPath = vi.fn(async () => "Failed to open");
    await expect(openPathWithOpener("/tmp/a.md", openPath)).resolves.toEqual({
      opened: false,
      reason: "open-failed",
    });
  });

  it("maps thrown errors to open-failed", async () => {
    const openPath = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(openPathWithOpener("/tmp/a.md", openPath)).resolves.toEqual({
      opened: false,
      reason: "open-failed",
    });
  });
});
