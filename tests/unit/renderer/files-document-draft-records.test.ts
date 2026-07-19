import {
  diskDraftStorageKey,
  legacyDiskDraftStorageKey,
  parsePersistedDiskDraft,
  serializeDiskDraft,
  transferStagingDraftKey,
  untitledDraftStorageKey,
} from "@plugins/builtin/files/renderer/files-document-draft-records.ts";
import { createDiskDocumentRecord } from "@plugins/builtin/files/renderer/files-document-factory.ts";
import {
  allocateExplicitDiskDocumentId,
  diskDocumentId,
} from "@plugins/builtin/files/renderer/files-document-paths.ts";
import type { FilesDocument } from "@plugins/builtin/files/renderer/files-document-types.ts";
import { describe, expect, it } from "vitest";

function diskDocument(
  overrides: Partial<FilesDocument> & {
    path?: string;
    root?: string;
  } = {}
): FilesDocument {
  const root = overrides.root ?? "/repo";
  const path = overrides.path ?? "README.md";
  const id = overrides.id ?? diskDocumentId(root, path);
  const base = createDiskDocumentRecord({
    draft: null,
    id,
    path,
    root,
  });
  const { path: _path, root: _root, ...documentOverrides } = overrides;
  return {
    ...base,
    ...documentOverrides,
    id,
    source: { kind: "disk", path, root },
  };
}

describe("files-document-draft-records", () => {
  it("keys disk drafts by document identity and keeps untitled keys", () => {
    const documentId = diskDocumentId("/repo", "README.md");
    expect(diskDraftStorageKey(documentId)).toBe(
      `pier.files.diskDraft:${documentId}`
    );
    expect(untitledDraftStorageKey("pier.files.untitled:1")).toBe(
      "pier.files.untitledDraft:pier.files.untitled:1"
    );
    expect(legacyDiskDraftStorageKey("/repo", "README.md")).toMatch(
      /^pier\.files\.diskDraft:[a-z0-9]+$/
    );
    expect(legacyDiskDraftStorageKey("/repo", "README.md")).not.toBe(
      diskDraftStorageKey(documentId)
    );
  });

  it("builds transfer staging draft keys from transfer id and original key", () => {
    const original = diskDraftStorageKey("pier.files.file:abc");
    expect(transferStagingDraftKey("transfer-1", original)).toBe(
      `pier.files.transferStaging:transfer-1:${original}`
    );
  });

  it("serializes dirty untitled-equivalent disk recovery fields and hydrates them", () => {
    const cases: Array<{
      label: string;
      patch: Partial<FilesDocument>;
    }> = [
      {
        label: "dirty",
        patch: { currentContents: "# dirty", dirty: true },
      },
      {
        label: "durabilityUnknown",
        patch: { durabilityUnknown: true },
      },
      {
        label: "diskConflict with conflictDiskContents",
        patch: {
          conflictDiskContents: "# on disk",
          diskConflict: true,
        },
      },
      {
        label: "deletedOnDisk",
        patch: {
          deletedOnDisk: true,
          dirty: true,
          diskConflict: true,
          hasBackingStore: false,
        },
      },
    ];

    for (const { label, patch } of cases) {
      const document = diskDocument(patch);
      const raw = serializeDiskDraft(document);
      expect(raw, label).not.toBeNull();
      const parsed = parsePersistedDiskDraft(raw!);
      expect(parsed, label).toMatchObject({
        conflictDiskContents: document.conflictDiskContents,
        currentContents: document.currentContents,
        deletedOnDisk: document.deletedOnDisk,
        dirty: document.dirty,
        diskConflict: document.diskConflict,
        durabilityUnknown: document.durabilityUnknown,
        id: document.id,
        path: "README.md",
        root: "/repo",
        savedContents: document.savedContents,
      });
    }
  });

  it("does not serialize a clean disk document without recoverable state", () => {
    expect(serializeDiskDraft(diskDocument())).toBeNull();
  });

  it("uses distinct draft keys for default and explicit identities on the same path", () => {
    const root = "/repo";
    const path = "shared.md";
    const defaultId = diskDocumentId(root, path);
    const explicitId = allocateExplicitDiskDocumentId();
    expect(explicitId).toMatch(
      /^pier\.files\.file:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(diskDraftStorageKey(defaultId)).not.toBe(
      diskDraftStorageKey(explicitId)
    );
  });
});
