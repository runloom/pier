/**
 * Cross-window panel transfer adapter for the Files file panel
 * (`pier.files.filePanel`).
 *
 * Draft body text never enters prepared state / journal. Recoverable drafts are
 * cloned to a transfer staging key (with `id` rewritten to the target document
 * identity), main copies staging→target, and the target renderer hydrates the
 * copied draft into the client store before ensuring the document.
 */

import type { PanelTransferRegistration } from "@plugins/api/panel-transfer-registration.ts";
import type {
  JsonValue,
  PanelTransferPreparedSource,
} from "@shared/contracts/panel-transfer.ts";
import {
  diskDraftHasRecoverableState,
  diskDraftStorageKey,
  serializeDiskDraft,
  serializeUntitledDocument,
  transferStagingDraftKey,
  untitledDraftStorageKey,
} from "./files-document-draft-records.ts";
import { allocateExplicitDiskDocumentId } from "./files-document-paths.ts";
import {
  type FilesDocument,
  type FilesDocumentPanelSource,
  parseFilesDocumentPanelSource,
  resolveDiskDocumentId,
  sameFilesDocumentPanelSource,
} from "./files-document-types.ts";
import {
  forgetFilesPanelTransfer,
  getFilesPanelTransfer,
  rememberFilesPanelTransfer,
  takeFilesPanelTransfer,
} from "./files-panel-transfer-bookkeeping.ts";
import {
  describeFilesPanelSourceParams,
  type FilesPanelTransferDeps,
  logFilesPanelTransfer,
  resolveFilesPanelTransferSource,
} from "./files-panel-transfer-source.ts";
import {
  type FilesPanelTransferPreparedState,
  type FilesPanelTransferViewSeed,
  parseFilesPanelTransferPreparedState,
  readFilesPanelViewMode,
  seedFilesPanelView,
} from "./files-panel-transfer-state.ts";
import { nextUntitledIdentity } from "./files-untitled-identity.ts";

export { clearFilesPanelTransferBookkeepingForTests } from "./files-panel-transfer-bookkeeping.ts";
export type {
  FilesPanelTransferDeps,
  FilesPanelTransferSourceResolution,
  FilesPanelTransferViewCapture,
} from "./files-panel-transfer-source.ts";
export {
  describeFilesPanelSourceParams,
  resolveFilesPanelTransferSource,
} from "./files-panel-transfer-source.ts";

function rewritePersistedDraftId(
  raw: string,
  targetDocumentId: string
): string {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Files panel transfer: invalid draft payload");
  }
  return JSON.stringify({
    ...(parsed as Record<string, unknown>),
    id: targetDocumentId,
  });
}

function allocateTargetSource(
  document: FilesDocument,
  deps: FilesPanelTransferDeps
): {
  targetDocumentId: string;
  targetSource: FilesDocumentPanelSource;
} {
  if (document.source.kind === "untitled") {
    const next =
      deps.nextUntitledIdentity?.({
        idExists: (id) =>
          deps.hasDocumentId?.(id) === true || deps.getDocument(id) !== null,
        nameExists: (name) => deps.hasDocumentName?.(name) === true,
      }) ??
      nextUntitledIdentity({
        idExists: (id) =>
          deps.hasDocumentId?.(id) === true || deps.getDocument(id) !== null,
        nameExists: (name) => deps.hasDocumentName?.(name) === true,
      });
    return {
      targetDocumentId: next.id,
      targetSource: {
        id: next.id,
        kind: "untitled",
        name: next.name,
      },
    };
  }
  const allocate =
    deps.allocateExplicitDiskDocumentId ?? allocateExplicitDiskDocumentId;
  const targetDocumentId = allocate();
  return {
    targetDocumentId,
    targetSource: {
      documentId: targetDocumentId,
      kind: "disk",
      path: document.source.path,
      root: document.source.root,
    },
  };
}

function captureViewSeed(
  deps: FilesPanelTransferDeps,
  panelId: string,
  documentId: string
): FilesPanelTransferViewSeed {
  const mode =
    deps.readFilesPanelViewMode?.(panelId) ?? readFilesPanelViewMode(panelId);
  const snapshot = deps.captureViewSnapshot?.({ documentId, panelId }) ?? null;
  return {
    mode,
    ...(snapshot?.selection ? { selection: snapshot.selection } : {}),
    ...(snapshot?.scroll ? { scroll: snapshot.scroll } : {}),
  };
}

function needsDraftMigration(document: FilesDocument): boolean {
  return (
    document.source.kind === "untitled" ||
    diskDraftHasRecoverableState(document)
  );
}

function originalDraftKeyFor(document: FilesDocument): string {
  return document.source.kind === "untitled"
    ? untitledDraftStorageKey(document.id)
    : diskDraftStorageKey(document.id);
}

function targetDraftKeyFor(source: FilesDocumentPanelSource): string {
  if (source.kind === "untitled") {
    return untitledDraftStorageKey(source.id);
  }
  return diskDraftStorageKey(resolveDiskDocumentId(source));
}

function serializeForStaging(document: FilesDocument): string {
  if (document.source.kind === "untitled") {
    const raw = serializeUntitledDocument(document);
    if (!raw) {
      throw new Error("Files panel transfer: untitled draft missing content");
    }
    return raw;
  }
  const raw = serializeDiskDraft(document);
  if (!raw) {
    throw new Error("Files panel transfer: disk draft not recoverable");
  }
  return raw;
}

function remainingReferencesSource(
  remainingParams: readonly Readonly<Record<string, unknown>>[],
  sourceDocumentId: string,
  sourcePanelSource: FilesDocumentPanelSource | null
): boolean {
  for (const params of remainingParams) {
    const source = parseFilesDocumentPanelSource(params);
    if (!source) {
      continue;
    }
    if (
      sourcePanelSource &&
      sameFilesDocumentPanelSource(source, sourcePanelSource)
    ) {
      return true;
    }
    if (source.kind === "untitled" && source.id === sourceDocumentId) {
      return true;
    }
    if (
      source.kind === "disk" &&
      resolveDiskDocumentId(source) === sourceDocumentId
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Build the `kind: "custom"` transfer registration for the Files file panel.
 */
export function createFilesPanelTransferRegistration(
  deps: FilesPanelTransferDeps
): PanelTransferRegistration {
  const seedView = deps.seedFilesPanelView ?? seedFilesPanelView;

  return {
    kind: "custom",

    async prepareSource({ panelId, params, transferId }) {
      const resolved = resolveFilesPanelTransferSource({
        ...(deps.getPanelSource ? { getPanelSource: deps.getPanelSource } : {}),
        panelId,
        params,
      });
      if (resolved.kind === "empty") {
        // Project explorer shell / empty file tab: no document to migrate.
        // Params-only move (context + title) — same shape as Git when scope
        // is absent.
        logFilesPanelTransfer("info", "prepareSource empty-shell", {
          panelId,
          transferId,
          detail: describeFilesPanelSourceParams(params),
        });
        return { drafts: [] };
      }
      if (resolved.kind === "invalid") {
        logFilesPanelTransfer("error", "prepareSource invalid source params", {
          panelId,
          transferId,
          detail: resolved.detail,
        });
        throw new Error(
          `Files panel transfer: invalid panel source params (${resolved.detail})`
        );
      }
      if (resolved.kind === "registry") {
        // Live dockview params failed schema / missing source — recovered
        // from the acquirePanel registry. Worth a warn so release builds
        // still leave a breadcrumb when params drift.
        logFilesPanelTransfer(
          "warn",
          "prepareSource recovered source from registry",
          {
            panelId,
            transferId,
            sourceKind: resolved.source.kind,
            detail: describeFilesPanelSourceParams(params),
          }
        );
      }
      const source = resolved.source;
      const sourceDocumentId =
        source.kind === "untitled" ? source.id : resolveDiskDocumentId(source);
      const transferScope = { documentId: sourceDocumentId, panelId };
      const abort = new AbortController();
      await deps.suspendTransferMutations(transferScope, abort.signal);
      try {
        const document = deps.getDocumentForPanelSource(source);
        if (!document) {
          logFilesPanelTransfer("error", "prepareSource document missing", {
            panelId,
            transferId,
            sourceKind: source.kind,
            sourceDocumentId,
          });
          throw new Error(
            `Files panel transfer: source document missing (panelId=${panelId}; sourceKind=${source.kind}; documentId=${sourceDocumentId})`
          );
        }
        if (document.source.kind === "untitled") {
          const untitledPayload = serializeUntitledDocument(document);
          if (!untitledPayload) {
            throw new Error(
              "Files panel transfer: untitled document has no recoverable draft"
            );
          }
        }

        const view = captureViewSeed(deps, panelId, document.id);
        const { targetDocumentId, targetSource } = allocateTargetSource(
          document,
          deps
        );

        let drafts: NonNullable<PanelTransferPreparedSource["drafts"]> = [];
        let originalDraftKey: string | undefined;
        if (needsDraftMigration(document)) {
          originalDraftKey = originalDraftKeyFor(document);
          const stagingKey = transferStagingDraftKey(
            transferId,
            originalDraftKey
          );
          const stagedPayload = rewritePersistedDraftId(
            serializeForStaging(document),
            targetDocumentId
          );
          deps.persistFilesDraftRecord(stagingKey, stagedPayload);
          await deps.flushFilesDraftWrites();
          const targetKey = targetDraftKeyFor(targetSource);
          drafts = [{ sourceKey: stagingKey, targetKey }];
        }

        const state: FilesPanelTransferPreparedState = {
          ...(originalDraftKey ? { originalDraftKey } : {}),
          sourceDocumentId: document.id,
          targetDocumentId,
          targetSource,
          view,
        };

        rememberFilesPanelTransfer(transferId, {
          createdTarget: false,
          ...(originalDraftKey ? { originalDraftKey } : {}),
          sourceDocumentId: document.id,
          targetDocumentId,
          ...(drafts[0] ? { targetDraftKey: drafts[0].targetKey } : {}),
          targetSource,
          transferScope,
          view,
        });

        // Release the scoped transfer barrier; host freeze keeps this panel
        // inert. Other tabs of the same document remain editable.
        deps.resumeTransferMutations(transferScope);
        const entry = getFilesPanelTransfer(transferId);
        if (entry) {
          entry.transferScope = null;
        }

        logFilesPanelTransfer("info", "prepareSource ok", {
          panelId,
          transferId,
          via: resolved.kind,
          sourceKind: source.kind,
          drafts: drafts.length,
          dirty: document.dirty,
        });

        return {
          drafts,
          state: state as unknown as JsonValue,
        };
      } catch (error) {
        deps.resumeTransferMutations(transferScope);
        forgetFilesPanelTransfer(transferId);
        logFilesPanelTransfer("error", "prepareSource failed", {
          panelId,
          transferId,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    async stageTarget({ panelId, prepared, transferId }) {
      // Params-only empty shell: prepareSource returned no prepared state.
      if (prepared.state == null) {
        return;
      }
      const state = parseFilesPanelTransferPreparedState(prepared.state);
      if (!state) {
        throw new Error("Files panel transfer: invalid prepared state");
      }

      const drafts = prepared.drafts ?? [];
      for (const mapping of drafts) {
        const hydrated = await deps.hydrateDraftKey(mapping.targetKey);
        if (hydrated === null) {
          throw new Error(
            `Files panel transfer: target draft missing: ${mapping.targetKey}`
          );
        }
      }

      let createdTarget = false;
      if (state.targetSource.kind === "untitled") {
        const existing = deps.getDocument(state.targetDocumentId);
        if (!existing) {
          const restored = deps.restoreUntitledDocumentFromPanelSource(
            state.targetSource
          );
          if (!restored) {
            throw new Error(
              "Files panel transfer: untitled target missing draft"
            );
          }
          createdTarget = true;
        }
      } else {
        const existing = deps.getDocument(state.targetDocumentId);
        if (!existing) {
          deps.ensureDiskDocument({
            documentId: state.targetDocumentId,
            path: state.targetSource.path,
            root: state.targetSource.root,
          });
          createdTarget = true;
        }
      }

      seedView({
        documentId: state.targetDocumentId,
        panelId,
        view: state.view,
      });

      const prior = getFilesPanelTransfer(transferId);
      rememberFilesPanelTransfer(transferId, {
        createdTarget: prior?.createdTarget || createdTarget,
        ...(state.originalDraftKey
          ? { originalDraftKey: state.originalDraftKey }
          : {}),
        sourceDocumentId: state.sourceDocumentId,
        targetDocumentId: state.targetDocumentId,
        ...(drafts[0] ? { targetDraftKey: drafts[0].targetKey } : {}),
        targetSource: state.targetSource,
        transferScope: prior?.transferScope ?? null,
        view: state.view,
      });

      return {
        params: {
          source: state.targetSource as unknown as JsonValue,
        },
      };
    },

    async restore({ panelId, role, snapshot }) {
      const state = parseFilesPanelTransferPreparedState(
        snapshot.prepared.state
      );
      if (!state) {
        return;
      }
      // Idempotent: re-apply view seed if needed; do not duplicate watchers
      // (panel mount / acquirePanel owns watches).
      if (role === "target") {
        seedView({
          documentId: state.targetDocumentId,
          panelId,
          view: state.view,
        });
      }
    },

    async releaseSource({ remainingParams, transferId }) {
      const entry = getFilesPanelTransfer(transferId);
      if (!entry?.originalDraftKey) {
        return;
      }
      if (
        remainingReferencesSource(remainingParams, entry.sourceDocumentId, null)
      ) {
        return;
      }
      // Only the original draft key — staging is owned by main commit/rollback.
      deps.removeFilesDraftRecord(entry.originalDraftKey);
    },

    async finalize({ outcome, role, transferId }) {
      const entry = getFilesPanelTransfer(transferId);
      if (entry?.transferScope) {
        deps.resumeTransferMutations(entry.transferScope);
        entry.transferScope = null;
      }

      if (outcome === "abort" && role === "target") {
        const targetEntry = takeFilesPanelTransfer(transferId);
        if (targetEntry?.createdTarget) {
          deps.discardDocument(targetEntry.targetDocumentId);
        } else if (targetEntry?.targetDraftKey) {
          deps.removeFilesDraftRecord(targetEntry.targetDraftKey);
        }
        return;
      }

      // commit (either role) or abort(source): clear bookkeeping. Watch starts
      // via existing acquirePanel on the target panel mount path.
      takeFilesPanelTransfer(transferId);
    },
  };
}
