import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  createFileClipboardCopyAction,
  createFileClipboardCutAction,
  createFileClipboardPasteAction,
} from "@plugins/builtin/files/renderer/tree/actions-clipboard.ts";
import {
  clearFilesTreeClipboard,
  hasFilesTreeClipboard,
  isPasteIntoSelfOrDescendant,
  pruneNestedClipboardEntries,
  readFilesTreeClipboard,
  resolvePasteParentDir,
  writeFilesTreeClipboard,
} from "@plugins/builtin/files/renderer/tree/file-clipboard.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@plugins/builtin/files/renderer/tree/store.ts", () => ({
  addFilesTreeEntry: vi.fn(),
  moveFilesTreeEntry: vi.fn(),
}));

function mockContext(overrides?: {
  copy?: ReturnType<typeof vi.fn>;
  exists?: ReturnType<typeof vi.fn>;
  move?: ReturnType<typeof vi.fn>;
}): RendererPluginContext {
  return {
    dialogs: {
      alert: vi.fn(async () => undefined),
    },
    files: {
      copy: overrides?.copy ?? vi.fn(async () => undefined),
      exists: overrides?.exists ?? vi.fn(async () => ({ exists: false })),
      move: overrides?.move ?? vi.fn(async () => undefined),
    },
    i18n: {
      t: vi.fn((_key: string, values?: unknown, fallback = "") => {
        if (!(values && typeof values === "object")) {
          return fallback;
        }
        return Object.entries(values as Record<string, unknown>).reduce(
          (text, [key, value]) => text.replace(`{{${key}}}`, String(value)),
          fallback
        );
      }),
    },
    notifications: {
      error: vi.fn(),
      success: vi.fn(),
    },
  } as unknown as RendererPluginContext;
}

const t = (
  _key: string,
  fallback: string,
  values?: Record<string, unknown>
) => {
  if (!values) {
    return fallback;
  }
  return Object.entries(values).reduce(
    (text, [k, v]) => text.replace(`{{${k}}}`, String(v)),
    fallback
  );
};

describe("files tree clipboard", () => {
  afterEach(() => {
    clearFilesTreeClipboard();
    vi.clearAllMocks();
  });

  it("stores cut/copy payload and reports readiness", () => {
    expect(hasFilesTreeClipboard()).toBe(false);
    writeFilesTreeClipboard({
      entries: [{ kind: "file", path: "src/a.ts" }],
      mode: "cut",
      root: "/repo",
    });
    expect(hasFilesTreeClipboard()).toBe(true);
    expect(readFilesTreeClipboard()).toEqual({
      entries: [{ kind: "file", path: "src/a.ts" }],
      mode: "cut",
      root: "/repo",
    });
    clearFilesTreeClipboard();
    expect(hasFilesTreeClipboard()).toBe(false);
  });

  it("resolves paste parent for file, directory, and background", () => {
    expect(resolvePasteParentDir({ kind: "file", path: "src/a.ts" })).toBe(
      "src"
    );
    expect(
      resolvePasteParentDir({ kind: "directory", path: "src/utils" })
    ).toBe("src/utils");
    expect(resolvePasteParentDir({})).toBe("");
  });

  it("prunes nested multi-select paths to ancestors only", () => {
    expect(
      pruneNestedClipboardEntries([
        { kind: "file", path: "src/a.ts" },
        { kind: "directory", path: "src" },
        { kind: "file", path: "src/nested/b.ts" },
        { kind: "file", path: "lib/c.ts" },
      ])
    ).toEqual([
      { kind: "directory", path: "src" },
      { kind: "file", path: "lib/c.ts" },
    ]);
  });

  it("detects paste into self or descendant", () => {
    expect(isPasteIntoSelfOrDescendant("src", "src")).toBe(true);
    expect(isPasteIntoSelfOrDescendant("src/nested", "src")).toBe(true);
    expect(isPasteIntoSelfOrDescendant("src", "lib")).toBe(false);
    expect(isPasteIntoSelfOrDescendant("", "src")).toBe(false);
  });

  it("cut action prunes nested selection before writing clipboard", () => {
    const context = mockContext();
    const cut = createFileClipboardCutAction(context, t);
    cut.handler({
      metadata: {
        entryKinds: {
          src: "directory",
          "src/a.ts": "file",
        },
        kind: "directory",
        path: "src",
        root: "/repo",
        selectedPaths: ["src", "src/a.ts"],
      },
    });
    expect(readFilesTreeClipboard()?.entries).toEqual([
      { kind: "directory", path: "src" },
    ]);
    expect(context.notifications.success).toHaveBeenCalled();
  });

  it("paste rejects wrong project root", async () => {
    writeFilesTreeClipboard({
      entries: [{ kind: "file", path: "a.ts" }],
      mode: "copy",
      root: "/repo-a",
    });
    const context = mockContext();
    const paste = createFileClipboardPasteAction(context, t);
    await paste.handler({
      metadata: { kind: "directory", path: "dest", root: "/repo-b" },
    });
    expect(context.notifications.error).toHaveBeenCalled();
    expect(context.files.copy).not.toHaveBeenCalled();
  });

  it("paste into self is blocked for copy mode", async () => {
    writeFilesTreeClipboard({
      entries: [{ kind: "directory", path: "src" }],
      mode: "copy",
      root: "/repo",
    });
    const context = mockContext();
    const paste = createFileClipboardPasteAction(context, t);
    await paste.handler({
      metadata: { kind: "directory", path: "src/nested", root: "/repo" },
    });
    expect(context.notifications.error).toHaveBeenCalled();
    expect(context.files.copy).not.toHaveBeenCalled();
  });

  it("cut paste clears only succeeded entries on partial failure", async () => {
    writeFilesTreeClipboard({
      entries: [
        { kind: "file", path: "a.ts" },
        { kind: "file", path: "b.ts" },
      ],
      mode: "cut",
      root: "/repo",
    });
    const move = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("busy"));
    const context = mockContext({ move });
    const paste = createFileClipboardPasteAction(context, t);
    await paste.handler({
      metadata: { kind: "directory", path: "dest", root: "/repo" },
    });
    expect(move).toHaveBeenCalledTimes(2);
    expect(readFilesTreeClipboard()?.entries).toEqual([
      { kind: "file", path: "b.ts" },
    ]);
    expect(context.dialogs.alert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringMatching(/Pasted 1 of 2|1 \/ 2/u),
      })
    );
  });

  it("copy paste success leaves clipboard for re-paste", async () => {
    writeFilesTreeClipboard({
      entries: [{ kind: "file", path: "a.ts" }],
      mode: "copy",
      root: "/repo",
    });
    const context = mockContext();
    const paste = createFileClipboardPasteAction(context, t);
    await paste.handler({
      metadata: { kind: "directory", path: "dest", root: "/repo" },
    });
    expect(context.files.copy).toHaveBeenCalledOnce();
    expect(hasFilesTreeClipboard()).toBe(true);
    expect(context.notifications.success).toHaveBeenCalled();
  });

  it("copy action only needs read permission declaration at call site", () => {
    const context = mockContext();
    const copy = createFileClipboardCopyAction(context, t);
    expect(copy.id).toBe("pier.files.clipboard.copy");
    copy.handler({
      metadata: {
        kind: "file",
        path: "a.ts",
        root: "/repo",
      },
    });
    expect(readFilesTreeClipboard()?.mode).toBe("copy");
  });
});
