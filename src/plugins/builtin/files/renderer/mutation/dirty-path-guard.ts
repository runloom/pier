/**
 * Renderer-owned snapshot used to decide whether a path operation can reclaim
 * open document state. It intentionally does not depend on FilesDocument so
 * the guard can be integrated while that store's persistence model evolves.
 */
export type FilesDirtyPathGuardDocument = FilesDirtyPathGuardState &
  (
    | {
        /** Root-relative real target path returned by main, when known. */
        canonicalPath?: string | null;
        kind: "disk";
        path: string;
        root: string;
      }
    | { kind: "untitled" }
  );

interface FilesDirtyPathGuardState {
  dirty: boolean;
  durabilityUnknown?: boolean;
  id: string;
  needsSaveAs?: boolean;
}

/**
 * A normalized impact returned by the main-process path inspection boundary.
 *
 * The union makes the symlink rule structural: a symlink entry has no
 * canonical backing prefix, so reclaiming the link cannot accidentally match
 * documents opened through the real target path.
 */
export type FilesNormalizedPathImpact =
  | {
      kind: "symlink-entry";
      locatorPrefix: string;
      root: string;
    }
  | {
      canonicalBackingPrefix: string;
      kind: "regular";
      locatorPrefix: string;
      root: string;
    };

export type FilesDirtyPathClassification =
  | "clean"
  | "dirty"
  | "durabilityUnknown"
  | "needsSaveAs";

export interface FilesDirtyPathGuardSummary {
  affectedDocumentIds: readonly string[];
  documentIdsByClassification: Readonly<
    Record<FilesDirtyPathClassification, readonly string[]>
  >;
  requiresProtectionDecision: boolean;
}

function isSamePathOrDescendant(path: string, prefix: string): boolean {
  return (
    prefix.length === 0 || path === prefix || path.startsWith(`${prefix}/`)
  );
}

function isDocumentAffected(
  document: FilesDirtyPathGuardDocument,
  impact: FilesNormalizedPathImpact
): boolean {
  if (document.kind !== "disk" || document.root !== impact.root) {
    return false;
  }
  if (isSamePathOrDescendant(document.path, impact.locatorPrefix)) {
    return true;
  }
  return (
    impact.kind === "regular" &&
    typeof document.canonicalPath === "string" &&
    isSamePathOrDescendant(
      document.canonicalPath,
      impact.canonicalBackingPrefix
    )
  );
}

/**
 * Returns each affected document once, in the same order as the open-document
 * input. Stable ordering keeps multi-file confirmation copy deterministic.
 */
export function findAffectedOpenDocuments<
  Document extends FilesDirtyPathGuardDocument,
>(
  documents: readonly Document[],
  impacts: readonly FilesNormalizedPathImpact[]
): Document[] {
  const matchedDocumentIds = new Set<string>();
  const affected: Document[] = [];

  for (const document of documents) {
    if (
      matchedDocumentIds.has(document.id) ||
      !impacts.some((impact) => isDocumentAffected(document, impact))
    ) {
      continue;
    }
    matchedDocumentIds.add(document.id);
    affected.push(document);
  }

  return affected;
}

/**
 * States are deliberately exclusive. Save As wins because the document has
 * no reusable target; newer dirty contents win over an older uncertain disk
 * commit; durability confirmation is needed only for an otherwise clean
 * buffer.
 */
export function classifyDocumentForPathGuard(
  document: FilesDirtyPathGuardDocument
): FilesDirtyPathClassification {
  if (document.needsSaveAs === true) {
    return "needsSaveAs";
  }
  if (document.dirty) {
    return "dirty";
  }
  if (document.durabilityUnknown === true) {
    return "durabilityUnknown";
  }
  return "clean";
}

/** Builds the minimum stable input needed by the reclaim confirmation flow. */
export function summarizeReclaimPathImpact(
  documents: readonly FilesDirtyPathGuardDocument[],
  impacts: readonly FilesNormalizedPathImpact[]
): FilesDirtyPathGuardSummary {
  const affected = findAffectedOpenDocuments(documents, impacts);
  const documentIdsByClassification: Record<
    FilesDirtyPathClassification,
    string[]
  > = {
    clean: [],
    dirty: [],
    durabilityUnknown: [],
    needsSaveAs: [],
  };

  for (const document of affected) {
    documentIdsByClassification[classifyDocumentForPathGuard(document)].push(
      document.id
    );
  }

  return {
    affectedDocumentIds: affected.map(({ id }) => id),
    documentIdsByClassification,
    requiresProtectionDecision:
      documentIdsByClassification.dirty.length > 0 ||
      documentIdsByClassification.durabilityUnknown.length > 0 ||
      documentIdsByClassification.needsSaveAs.length > 0,
  };
}
