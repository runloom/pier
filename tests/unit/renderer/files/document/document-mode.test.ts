import {
  computeDocumentDirty,
  protectsLocalBufferFromDisk,
} from "@plugins/builtin/files/renderer/document/disk-protection.ts";
import { createDiskDocumentRecord } from "@plugins/builtin/files/renderer/document/factory.ts";
import { refreshDiskDocumentLanguagesForProject } from "@plugins/builtin/files/renderer/document/live-modules-sync.ts";
import {
  withDocumentContents,
  withDocumentLanguage,
  withDocumentPathReconciled,
  withDocumentSaveEol,
  withDocumentSaveFormat,
} from "@plugins/builtin/files/renderer/document/reducers.ts";
import {
  clearFilesDocumentStore,
  createUntitledDocument,
} from "@plugins/builtin/files/renderer/document/store.ts";
import {
  encodingIdFromFormat,
  formatFromEncodingId,
} from "@plugins/builtin/files/renderer/panel/document-mode/select.ts";
import type { FileDocumentReadResult } from "@shared/contracts/file.ts";
import { afterEach, describe, expect, it } from "vitest";

function textReadResult(
  overrides: Partial<Extract<FileDocumentReadResult, { kind: "text" }>> = {}
): Extract<FileDocumentReadResult, { kind: "text" }> {
  return {
    canonicalPath: "notes.txt",
    contents: "hello\n",
    eol: "lf",
    format: { bom: false, encoding: "utf8" },
    kind: "text",
    mode: 0o644,
    mtimeMs: 1,
    path: "notes.txt",
    revision: "rev-1",
    root: "/repo",
    size: 6,
    writable: true,
    ...overrides,
  };
}

afterEach(() => {
  clearFilesDocumentStore();
});

describe("document language and save format", () => {
  it("changes untitled language without marking the buffer dirty", () => {
    const document = createUntitledDocument({
      contents: "",
      language: "text",
      nameKind: "plain",
    });
    const next = withDocumentLanguage(document, "typescript");
    expect(next.language).toBe("typescript");
    expect(next.dirty).toBe(false);
    expect(next.source.kind).toBe("untitled");
    if (next.source.kind === "untitled") {
      expect(next.source.language).toBe("typescript");
    }
  });

  it("marks the document dirty when the save line ending changes", () => {
    const document = createUntitledDocument({
      contents: "a\n",
      language: "text",
      nameKind: "plain",
    });
    const next = withDocumentSaveEol(document, "crlf");
    expect(next.eol).toBe("crlf");
    expect(next.dirty).toBe(true);
    expect(next.currentContents).toBe(document.currentContents);
  });

  it("maps encoding picker ids to save formats", () => {
    expect(formatFromEncodingId("utf8")).toEqual({
      bom: false,
      encoding: "utf8",
    });
    expect(formatFromEncodingId("utf8-bom")).toEqual({
      bom: true,
      encoding: "utf8",
    });
    expect(encodingIdFromFormat({ bom: false, encoding: "utf8" })).toBe("utf8");
    const document = createUntitledDocument({
      contents: "",
      language: "text",
      nameKind: "plain",
    });
    const next = withDocumentSaveFormat(document, {
      bom: true,
      encoding: "utf8",
    });
    expect(next.format).toEqual({ bom: true, encoding: "utf8" });
    expect(next.dirty).toBe(true);
  });

  it("keeps an EOL picker change dirty after a no-op content sync", () => {
    const document = createUntitledDocument({
      contents: "a\n",
      language: "text",
      nameKind: "plain",
    });
    const changed = withDocumentSaveEol(document, "crlf");
    const synced = withDocumentContents(changed, changed.currentContents);
    expect(synced.eol).toBe("crlf");
    expect(synced.dirty).toBe(true);
    expect(computeDocumentDirty(synced)).toBe(true);
  });

  it("protects a picked encoding from a matching-contents disk reload", () => {
    const loaded = withDocumentPathReconciled(
      createDiskDocumentRecord({
        draft: null,
        id: "pier.files.file:notes",
        path: "notes.txt",
        root: "/repo",
      }),
      textReadResult()
    );
    const picked = withDocumentSaveFormat(loaded, {
      bom: true,
      encoding: "utf8",
    });
    expect(protectsLocalBufferFromDisk(picked)).toBe(true);
    const reloaded = withDocumentPathReconciled(
      picked,
      textReadResult({
        mtimeMs: 2,
        revision: "rev-2",
      })
    );
    expect(reloaded.format).toEqual({ bom: true, encoding: "utf8" });
    expect(reloaded.eol).toBe("lf");
    expect(reloaded.dirty).toBe(true);
    expect(reloaded.currentContents).toBe("hello\n");
  });

  it("keeps a picked disk language across a live-modules language refresh", () => {
    const loaded = withDocumentPathReconciled(
      createDiskDocumentRecord({
        draft: null,
        id: "pier.files.file:notes",
        path: "notes.txt",
        root: "/repo",
      }),
      textReadResult()
    );
    const picked = withDocumentLanguage(loaded, "python");
    const documents = new Map([[picked.id, picked]]);
    refreshDiskDocumentLanguagesForProject({
      documents,
      projectRootPath: "/repo",
      replaceDocument: (id, update) => {
        const current = documents.get(id);
        if (current) {
          documents.set(id, update(current));
        }
      },
    });
    expect(documents.get(picked.id)?.language).toBe("python");
  });

  it("still restamps a path-derived language when live-modules roots change", () => {
    const document = createDiskDocumentRecord({
      draft: null,
      id: "pier.files.file:canvas",
      path: "notes.txt",
      root: "/repo",
    });
    expect(document.language).toBe("text");
    const overriddenPath = {
      ...document,
      language: "python",
    };
    const documents = new Map([[overriddenPath.id, overriddenPath]]);
    refreshDiskDocumentLanguagesForProject({
      documents,
      projectRootPath: "/repo",
      replaceDocument: (id, update) => {
        const current = documents.get(id);
        if (current) {
          documents.set(id, update(current));
        }
      },
    });
    expect(documents.get(document.id)?.language).toBe("text");
  });
});
