import {
  fileContentQueryItemSchema,
  fileContentQueryStartSchema,
  filePathQueryStartSchema,
  fileQueryEventSchema,
  isFileContentQueryStart,
} from "@shared/contracts/file/query.ts";
import { expect, it } from "vitest";

it("accepts a path query start payload", () => {
  const parsed = filePathQueryStartSchema.parse({
    queryId: "q1",
    owner: "quick-open:1",
    root: "/repo",
    query: "theme.ts",
    limit: 200,
    mruPaths: ["src/main/ipc/theme.ts"],
    options: { applyGitIgnore: true, applyExcludePatterns: true },
  });
  expect(parsed.limit).toBe(200);
  expect(isFileContentQueryStart(parsed)).toBe(false);
});

it("accepts an explicit path mode on start", () => {
  const parsed = filePathQueryStartSchema.parse({
    mode: "path",
    queryId: "q1",
    owner: "quick-open:1",
    root: "/repo",
    query: "a",
  });
  expect(parsed.mode).toBe("path");
});

it("accepts a content query start payload", () => {
  const parsed = fileContentQueryStartSchema.parse({
    mode: "content",
    queryId: "c1",
    owner: "content-search:panel-1",
    root: "/repo",
    query: "TODO",
    options: {
      caseSensitive: true,
      wholeWord: false,
      regexp: false,
      include: "**/*.{ts,tsx}",
      applyGitIgnore: true,
      maxResults: 500,
      scopeDir: "src/main",
    },
  });
  expect(isFileContentQueryStart(parsed)).toBe(true);
  expect(parsed.options?.scopeDir).toBe("src/main");
});

it("rejects content start without mode content", () => {
  expect(() =>
    fileContentQueryStartSchema.parse({
      queryId: "c1",
      owner: "content-search:1",
      root: "/repo",
      query: "x",
    })
  ).toThrow();
});

it("accepts done event", () => {
  expect(
    fileQueryEventSchema.parse({
      kind: "done",
      queryId: "q1",
      reason: "completed",
      truncated: false,
      scanned: 10,
      elapsedMs: 12,
    }).kind
  ).toBe("done");
});

it("accepts path batch event with mode", () => {
  const event = fileQueryEventSchema.parse({
    kind: "batch",
    mode: "path",
    queryId: "q1",
    items: [{ path: "a.ts", score: 1 }],
  });
  expect(event.kind).toBe("batch");
  if (event.kind === "batch") {
    expect(event.mode).toBe("path");
  }
});

it("accepts content batch event with hit fields", () => {
  const item = fileContentQueryItemSchema.parse({
    path: "src/a.ts",
    line: 12,
    matchCharStart: 4,
    matchCharEnd: 8,
    matchByteStart: 100,
    matchByteEnd: 104,
    preview: "foo TODO bar",
    previewMatchStart: 4,
    previewMatchEnd: 8,
  });
  const event = fileQueryEventSchema.parse({
    kind: "batch",
    mode: "content",
    queryId: "c1",
    items: [item],
  });
  expect(event.kind).toBe("batch");
  if (event.kind === "batch" && event.mode === "content") {
    expect(event.items[0]?.line).toBe(12);
  }
});
