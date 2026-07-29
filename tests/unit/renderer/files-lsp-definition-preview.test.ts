import { Text } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import { loadFilesLspDefinitionPreview } from "../../../src/plugins/builtin/files/renderer/files-lsp-definition-preview.ts";

const textDocument = (contents: string, canonicalPath = "src/target.ts") => ({
  canonicalPath,
  contents,
  eol: "lf" as const,
  format: { bom: false as const, encoding: "utf8" as const },
  kind: "text" as const,
  revision: "revision-1",
});

const target = (uri: string, line = 0) => ({
  range: {
    end: { character: 1, line },
    start: { character: 0, line },
  },
  uri,
});

const numberedLines = (from: number, through: number) =>
  Array.from({ length: through - from + 1 }, (_, offset) => ({
    lineNumber: from + offset,
    text: `line-${from + offset}`,
    truncated: false,
  }));

const previewDocument = (contents: string) =>
  Text.of(contents.split(/\r\n|\n|\r/));

describe("loadFilesLspDefinitionPreview", () => {
  it("uses the current editor contents for a same-file target without reading from disk", async () => {
    const readDocument = vi.fn();

    await expect(
      loadFilesLspDefinitionPreview({
        currentDocument: previewDocument("line-1\nline-2\nline-3"),
        currentUri: "file:///repo/src/current.ts",
        readDocument,
        serverRoot: "/repo",
        target: target("file:///repo/src/current.ts", 1),
      })
    ).resolves.toEqual(numberedLines(1, 3));
    expect(readDocument).not.toHaveBeenCalled();
  });

  it.each([
    {
      currentUri: "file:///repo/src/current.ts",
      expected: { path: "lib/target.ts", root: "/repo" },
      serverRoot: "/repo/",
      targetUri: "file:///repo/lib/target.ts",
    },
    {
      currentUri: "file:///C:/repo/src/current.ts",
      expected: { path: "lib/target.ts", root: "C:/repo" },
      serverRoot: "C:\\repo\\",
      targetUri: "file:///C:/repo/lib/target.ts",
    },
  ])("normalizes $serverRoot and reads only the root-relative cross-file path", async ({
    currentUri,
    expected,
    serverRoot,
    targetUri,
  }) => {
    const readDocument = vi.fn(async () => textDocument("line-1\r\nline-2"));

    await expect(
      loadFilesLspDefinitionPreview({
        currentDocument: previewDocument("current"),
        currentUri,
        readDocument,
        serverRoot,
        target: target(targetUri, 1),
      })
    ).resolves.toEqual([
      { lineNumber: 1, text: "line-1", truncated: false },
      { lineNumber: 2, text: "line-2", truncated: false },
    ]);
    expect(readDocument).toHaveBeenCalledOnce();
    expect(readDocument).toHaveBeenCalledWith(expected);
  });

  it("does not prepend an absolute root already present in the target URI", async () => {
    const readDocument = vi.fn(async () => textDocument("target"));

    await loadFilesLspDefinitionPreview({
      currentDocument: previewDocument("current"),
      currentUri: "file:///repo/current.ts",
      readDocument,
      serverRoot: "/repo",
      target: target("file:///repo/src/foo.ts"),
    });

    expect(readDocument).toHaveBeenCalledWith({
      path: "src/foo.ts",
      root: "/repo",
    });
  });

  it.each([
    {
      caseName: "a non-file URI",
      currentUri: "file:///repo/current.ts",
      serverRoot: "/repo",
      targetUri: "https://example.com/repo/target.ts",
    },
    {
      caseName: "a raw parent segment",
      currentUri: "file:///repo/current.ts",
      serverRoot: "/repo",
      targetUri: "file:///repo/src/../target.ts",
    },
    {
      caseName: "an encoded parent segment",
      currentUri: "file:///repo/current.ts",
      serverRoot: "/repo",
      targetUri: "file:///repo/src/%2e%2e/target.ts",
    },
    {
      caseName: "a sibling prefix",
      currentUri: "file:///repo/current.ts",
      serverRoot: "/repo",
      targetUri: "file:///repo-sibling/target.ts",
    },
    {
      caseName: "a path outside the root",
      currentUri: "file:///repo/current.ts",
      serverRoot: "/repo",
      targetUri: "file:///outside/target.ts",
    },
    {
      caseName: "a Windows sibling prefix",
      currentUri: "file:///C:/repo/current.ts",
      serverRoot: "C:\\repo",
      targetUri: "file:///C:/repository/target.ts",
    },
  ])("rejects $caseName before file I/O", async ({
    currentUri,
    serverRoot,
    targetUri,
  }) => {
    const readDocument = vi.fn();

    await expect(
      loadFilesLspDefinitionPreview({
        currentDocument: previewDocument("current"),
        currentUri,
        readDocument,
        serverRoot,
        target: target(targetUri),
      })
    ).resolves.toBeNull();
    expect(readDocument).not.toHaveBeenCalled();
  });

  it.each([
    "binary",
    "too-large",
    "unsupported-encoding",
  ] as const)("returns unavailable for a cross-file %s document and never falls back to readText", async (kind) => {
    const readDocument = vi.fn(async () => ({ kind }));
    const readText = vi.fn(async () => "deprecated fallback");
    const input = {
      currentDocument: previewDocument("current"),
      currentUri: "file:///repo/current.ts",
      readDocument,
      readText,
      serverRoot: "/repo",
      target: target("file:///repo/target.ts"),
    };

    await expect(loadFilesLspDefinitionPreview(input)).resolves.toBeNull();
    expect(readDocument).toHaveBeenCalledOnce();
    expect(readText).not.toHaveBeenCalled();
  });

  it("rejects a server preview when the target line is outside its returned range", async () => {
    const contents = Array.from(
      { length: 80 },
      (_, index) => `line-${index + 1}`
    ).join("\n");
    const readDocument = vi.fn(async () => ({
      ...textDocument(contents),
      range: { from: 100, to: 120 },
    }));

    await expect(
      loadFilesLspDefinitionPreview({
        currentDocument: previewDocument("current"),
        currentUri: "file:///repo/current.ts",
        readDocument,
        serverRoot: "/repo",
        target: target("file:///repo/src/foo.ts", 50),
      })
    ).resolves.toBeNull();
  });

  it("returns at most three lines on either side of the 1-based target line", async () => {
    const contents = Array.from(
      { length: 10 },
      (_, index) => `line-${index + 1}`
    ).join("\n");
    const readDocument = vi.fn();
    const loadAt = (line: number) =>
      loadFilesLspDefinitionPreview({
        currentDocument: previewDocument(contents),
        currentUri: "file:///repo/current.ts",
        readDocument,
        serverRoot: "/repo",
        target: target("file:///repo/current.ts", line),
      });

    await expect(loadAt(4)).resolves.toEqual(numberedLines(2, 8));
    await expect(loadAt(0)).resolves.toEqual(numberedLines(1, 4));
    await expect(loadAt(9)).resolves.toEqual(numberedLines(7, 10));
    expect(readDocument).not.toHaveBeenCalled();
  });

  it("reads only the bounded current-document lines needed for a large preview", async () => {
    const targetLine = 500_000;
    const line = vi.fn((number: number) => ({
      from: number * 10,
      number,
      text: `line-${number}`,
      to: number * 10 + 8,
    }));
    const currentDocument = {
      length: 10_000_000,
      line,
      lines: 1_000_000,
    };

    await expect(
      loadFilesLspDefinitionPreview({
        currentDocument,
        currentUri: "file:///repo/current.ts",
        readDocument: vi.fn(),
        serverRoot: "/repo",
        target: target("file:///repo/current.ts", targetLine),
      })
    ).resolves.toEqual(numberedLines(targetLine - 2, targetLine + 4));
    expect(line).toHaveBeenCalledTimes(7);
    expect(line).toHaveBeenNthCalledWith(1, targetLine - 2);
    expect(line).toHaveBeenNthCalledWith(7, targetLine + 4);
  });

  it("limits each line to a safe 512-UTF-16-unit prefix and marks only truncated lines", async () => {
    const exactlyAtLimit = "a".repeat(512);
    const overLimit = "b".repeat(513);
    const surrogateAtBoundary = `${"c".repeat(510)}😀tail`;
    const surrogateAcrossBoundary = `${"d".repeat(511)}😀tail`;

    await expect(
      loadFilesLspDefinitionPreview({
        currentDocument: previewDocument(
          [
            exactlyAtLimit,
            overLimit,
            surrogateAtBoundary,
            surrogateAcrossBoundary,
          ].join("\n")
        ),
        currentUri: "file:///repo/current.ts",
        readDocument: vi.fn(),
        serverRoot: "/repo",
        target: target("file:///repo/current.ts", 1),
      })
    ).resolves.toEqual([
      { lineNumber: 1, text: exactlyAtLimit, truncated: false },
      { lineNumber: 2, text: "b".repeat(512), truncated: true },
      {
        lineNumber: 3,
        text: `${"c".repeat(510)}😀`,
        truncated: true,
      },
      { lineNumber: 4, text: "d".repeat(511), truncated: true },
    ]);
  });

  it("turns cross-file read failures into an unavailable preview", async () => {
    const readDocument = vi.fn(async () => {
      throw new Error("disk unavailable");
    });

    await expect(
      loadFilesLspDefinitionPreview({
        currentDocument: previewDocument("current"),
        currentUri: "file:///repo/current.ts",
        readDocument,
        serverRoot: "/repo",
        target: target("file:///repo/target.ts"),
      })
    ).resolves.toBeNull();
    expect(readDocument).toHaveBeenCalledOnce();
  });
});
