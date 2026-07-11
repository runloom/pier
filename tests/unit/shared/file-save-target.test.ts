import {
  fileSaveTargetRequestSchema,
  fileSaveTargetResultSchema,
} from "@shared/contracts/file-save-target.ts";
import { describe, expect, it } from "vitest";

const context = {
  contextId: "ctx:repo",
  projectRootPath: "/repo",
  updatedAt: 1,
};

describe("file save target contract", () => {
  it("accepts a strict panel context and a safe suggested file name", () => {
    expect(
      fileSaveTargetRequestSchema.parse({
        context,
        suggestedName: "notes.md",
      })
    ).toEqual({ context, suggestedName: "notes.md" });
  });

  it.each([
    "../notes.md",
    "docs/notes.md",
    "docs\\notes.md",
    ".",
    "..",
  ])("rejects unsafe suggested name %s", (suggestedName) => {
    expect(
      fileSaveTargetRequestSchema.safeParse({ context, suggestedName }).success
    ).toBe(false);
  });

  it("rejects forged fields instead of silently stripping them", () => {
    expect(
      fileSaveTargetRequestSchema.safeParse({
        context: { ...context, projectId: "forged" },
      }).success
    ).toBe(false);
    expect(
      fileSaveTargetRequestSchema.safeParse({ context, owner: "forged" })
        .success
    ).toBe(false);
    expect(
      fileSaveTargetRequestSchema.safeParse({
        context: { ...context, projectRootPath: "relative/repo" },
      }).success
    ).toBe(false);
  });

  it("accepts cancel and a recoverable root-relative target", () => {
    expect(fileSaveTargetResultSchema.parse(null)).toBeNull();
    expect(
      fileSaveTargetResultSchema.parse({
        context,
        path: "src/notes.md",
        root: "/repo",
      })
    ).toEqual({ context, path: "src/notes.md", root: "/repo" });
    expect(
      fileSaveTargetResultSchema.safeParse({
        context,
        path: "../outside.md",
        root: "/repo",
      }).success
    ).toBe(false);
    expect(
      fileSaveTargetResultSchema.safeParse({
        context,
        path: "notes.md",
        root: "relative/repo",
      }).success
    ).toBe(false);
    expect(
      fileSaveTargetResultSchema.safeParse({
        context,
        path: "notes.md",
        root: "/different-root",
      }).success
    ).toBe(false);
  });
});
