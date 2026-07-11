import {
  type FilesDirtyPathGuardDocument,
  type FilesNormalizedPathImpact,
  findAffectedOpenDocuments,
  summarizeReclaimPathImpact,
} from "@plugins/builtin/files/renderer/files-dirty-path-guard.ts";
import { describe, expect, it } from "vitest";

const ROOT = "/repo";

interface DocumentStateOverrides {
  dirty?: boolean;
  durabilityUnknown?: boolean;
  needsSaveAs?: boolean;
}

interface DiskDocumentOverrides extends DocumentStateOverrides {
  canonicalPath?: string | null;
  root?: string;
}

function diskDocument(
  id: string,
  path: string,
  input: DiskDocumentOverrides = {}
): FilesDirtyPathGuardDocument {
  return {
    canonicalPath: path,
    dirty: false,
    durabilityUnknown: false,
    id,
    kind: "disk",
    needsSaveAs: false,
    path,
    root: ROOT,
    ...input,
  };
}

function untitledDocument(
  id: string,
  input: DocumentStateOverrides = {}
): FilesDirtyPathGuardDocument {
  return {
    dirty: false,
    durabilityUnknown: false,
    id,
    kind: "untitled",
    needsSaveAs: true,
    ...input,
  };
}

describe("files-dirty-path-guard", () => {
  it("matches a symlink entry only through its locator prefix", () => {
    const documents = [
      diskDocument("direct", "src/index.ts"),
      diskDocument("through-link", "linked-src/index.ts", {
        canonicalPath: "src/index.ts",
      }),
      diskDocument("sibling", "linked-src-old/index.ts", {
        canonicalPath: "src/index.ts",
      }),
    ];
    const impact: FilesNormalizedPathImpact = {
      kind: "symlink-entry",
      locatorPrefix: "linked-src",
      root: ROOT,
    };

    expect(
      findAffectedOpenDocuments(documents, [impact]).map(({ id }) => id)
    ).toEqual(["through-link"]);
  });

  it("matches a regular entry through both locator and canonical backing prefixes", () => {
    const documents = [
      diskDocument("direct", "src/index.ts"),
      diskDocument("through-link", "linked-src/index.ts", {
        canonicalPath: "src/index.ts",
      }),
      diskDocument("unrelated", "other/index.ts"),
    ];
    const impact: FilesNormalizedPathImpact = {
      canonicalBackingPrefix: "src",
      kind: "regular",
      locatorPrefix: "src",
      root: ROOT,
    };

    expect(
      findAffectedOpenDocuments(documents, [impact]).map(({ id }) => id)
    ).toEqual(["direct", "through-link"]);
  });

  it("uses path-segment boundaries and keeps roots isolated", () => {
    const documents = [
      diskDocument("exact", "src"),
      diskDocument("descendant", "src/lib/index.ts"),
      diskDocument("similar-locator", "src-old/index.ts"),
      diskDocument("similar-canonical", "alias/index.ts", {
        canonicalPath: "src-old/index.ts",
      }),
      diskDocument("other-root", "src/index.ts", { root: "/other" }),
    ];
    const impact: FilesNormalizedPathImpact = {
      canonicalBackingPrefix: "src",
      kind: "regular",
      locatorPrefix: "src",
      root: ROOT,
    };

    expect(
      findAffectedOpenDocuments(documents, [impact]).map(({ id }) => id)
    ).toEqual(["exact", "descendant"]);
  });

  it("deduplicates multiple impacts while preserving open-document order", () => {
    const documents = [
      diskDocument("first", "src/a.ts"),
      diskDocument("second", "src/nested/b.ts"),
      diskDocument("third", "docs/readme.md"),
    ];
    const impacts: readonly FilesNormalizedPathImpact[] = [
      {
        canonicalBackingPrefix: "src",
        kind: "regular",
        locatorPrefix: "src",
        root: ROOT,
      },
      {
        canonicalBackingPrefix: "src/nested",
        kind: "regular",
        locatorPrefix: "src/nested",
        root: ROOT,
      },
      {
        canonicalBackingPrefix: "docs/readme.md",
        kind: "regular",
        locatorPrefix: "docs/readme.md",
        root: ROOT,
      },
    ];

    expect(
      findAffectedOpenDocuments(documents, impacts).map(({ id }) => id)
    ).toEqual(["first", "second", "third"]);
  });

  it("classifies affected documents for one stable reclaim decision", () => {
    const documents = [
      diskDocument("clean", "src/clean.ts"),
      diskDocument("dirty", "src/dirty.ts", { dirty: true }),
      diskDocument("save-as", "src/deleted.ts", {
        dirty: true,
        needsSaveAs: true,
      }),
      diskDocument("durability", "src/committed.ts", {
        durabilityUnknown: true,
      }),
      diskDocument("dirty-newer-than-commit", "src/newer.ts", {
        dirty: true,
        durabilityUnknown: true,
      }),
      untitledDocument("untitled", { dirty: true }),
      diskDocument("outside", "docs/outside.md", { dirty: true }),
    ];
    const impact: FilesNormalizedPathImpact = {
      canonicalBackingPrefix: "src",
      kind: "regular",
      locatorPrefix: "src",
      root: ROOT,
    };

    expect(summarizeReclaimPathImpact(documents, [impact])).toEqual({
      affectedDocumentIds: [
        "clean",
        "dirty",
        "save-as",
        "durability",
        "dirty-newer-than-commit",
      ],
      documentIdsByClassification: {
        clean: ["clean"],
        dirty: ["dirty", "dirty-newer-than-commit"],
        durabilityUnknown: ["durability"],
        needsSaveAs: ["save-as"],
      },
      requiresProtectionDecision: true,
    });
  });

  it("allows immediate reclaim when no affected document needs protection", () => {
    const impact: FilesNormalizedPathImpact = {
      kind: "symlink-entry",
      locatorPrefix: "linked-src",
      root: ROOT,
    };

    expect(
      summarizeReclaimPathImpact(
        [
          diskDocument("clean", "linked-src/index.ts"),
          untitledDocument("untitled", { dirty: true }),
        ],
        [impact]
      )
    ).toEqual({
      affectedDocumentIds: ["clean"],
      documentIdsByClassification: {
        clean: ["clean"],
        dirty: [],
        durabilityUnknown: [],
        needsSaveAs: [],
      },
      requiresProtectionDecision: false,
    });
  });
});
