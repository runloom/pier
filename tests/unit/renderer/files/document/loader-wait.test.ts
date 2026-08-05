import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  authorizeDiskReplace,
  clearDiskReplaceAuthorizationsForTests,
  isDiskReplaceAuthorized,
} from "@plugins/builtin/files/renderer/document/disk-protection.ts";
import { FileDocumentLoader } from "@plugins/builtin/files/renderer/document/loader.ts";
import {
  clearFilesDocumentStore,
  ensureDiskDocument,
  getDocument,
  markDocumentReadResult,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/document/store.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  clearFilesDocumentStore();
  clearDiskReplaceAuthorizationsForTests();
  vi.restoreAllMocks();
});

function seed(contents: string, revision: string, mtimeMs: number) {
  const document = ensureDiskDocument({
    path: "notes.md",
    root: "/repo",
  });
  markDocumentReadResult(document.id, {
    canonicalPath: "notes.md",
    contents,
    eol: "lf",
    format: { bom: false, encoding: "utf8" },
    kind: "text",
    mode: 0o644,
    mtimeMs,
    path: "notes.md",
    revision,
    root: "/repo",
    size: contents.length,
    writable: true,
  });
  return getDocument(document.id)!;
}

describe("FileDocumentLoader.waitFor", () => {
  it("drains a chained pending reload so force-adopt after an in-flight watch applies", async () => {
    const document = seed("# local saved\n", "r1", 1);
    updateDocumentContents(document.id, "# local dirty\n");

    let releaseFirst!: (value: unknown) => void;
    const firstRead = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const readDocument = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstRead;
        return {
          canonicalPath: "notes.md",
          contents: "# from first watch\n",
          eol: "lf" as const,
          format: { bom: false as const, encoding: "utf8" as const },
          kind: "text" as const,
          mode: 0o644,
          mtimeMs: 2,
          path: "notes.md",
          revision: "r2",
          root: "/repo",
          size: 18,
          writable: true,
        };
      })
      .mockImplementationOnce(async () => ({
        canonicalPath: "notes.md",
        contents: "# force disk\n",
        eol: "lf" as const,
        format: { bom: false as const, encoding: "utf8" as const },
        kind: "text" as const,
        mode: 0o644,
        mtimeMs: 3,
        path: "notes.md",
        revision: "r3",
        root: "/repo",
        size: 13,
        writable: true,
      }));

    const loader = new FileDocumentLoader({
      files: { readDocument },
      i18n: { t: (_k: string, _v: unknown, f: string) => f },
    } as unknown as RendererPluginContext);

    // Watch-style reload in flight (no force yet).
    loader.start(document.id, true);
    expect(readDocument).toHaveBeenCalledTimes(1);

    // Banner force-adopt while first op is still open: queues pending, keeps auth.
    authorizeDiskReplace(document.id);
    loader.start(document.id, true);
    expect(readDocument).toHaveBeenCalledTimes(1);
    expect(isDiskReplaceAuthorized(document.id)).toBe(true);

    const waited = loader.waitFor(document.id);
    releaseFirst({});
    await waited;

    expect(readDocument).toHaveBeenCalledTimes(2);
    expect(getDocument(document.id)).toMatchObject({
      currentContents: "# force disk\n",
      dirty: false,
      diskConflict: false,
    });
    expect(isDiskReplaceAuthorized(document.id)).toBe(false);
    loader.dispose();
  });

  it("clears force-adopt authorization on invalidate", () => {
    const document = seed("# x\n", "r1", 1);
    authorizeDiskReplace(document.id);
    expect(isDiskReplaceAuthorized(document.id)).toBe(true);
    const loader = new FileDocumentLoader({
      files: { readDocument: vi.fn() },
      i18n: { t: (_k: string, _v: unknown, f: string) => f },
    } as unknown as RendererPluginContext);
    loader.invalidate(document.id);
    expect(isDiskReplaceAuthorized(document.id)).toBe(false);
    loader.dispose();
  });
});
