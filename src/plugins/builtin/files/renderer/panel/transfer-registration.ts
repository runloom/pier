import type { PanelTransferRegistration } from "@plugins/api/panel-transfer-registration.ts";
import type {
  JsonValue,
  PanelTransferPreparedSource,
} from "@shared/contracts/panel-transfer.ts";
import {
  serializeUntitledDocument,
  transferStagingDraftKey,
} from "../document/draft-records.ts";
import { resolveDiskDocumentId } from "../document/types.ts";
import {
  allocateTargetSource,
  captureViewSeed,
  describeFilesPanelSourceParams,
  type FilesPanelTransferDeps,
  forgetBookkeeping,
  getBookkeeping,
  logFilesPanelTransfer,
  needsDraftMigration,
  originalDraftKeyFor,
  remainingReferencesSource,
  rememberBookkeeping,
  resolveFilesPanelTransferSource,
  rewritePersistedDraftId,
  serializeForStaging,
  takeBookkeeping,
  targetDraftKeyFor,
} from "./transfer.ts";
import {
  type FilesPanelTransferPreparedState,
  parseFilesPanelTransferPreparedState,
  seedFilesPanelView,
} from "./transfer-state.ts";

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

        rememberBookkeeping(transferId, {
          createdTarget: false,
          ...(originalDraftKey ? { originalDraftKey } : {}),
          sourceDocumentId: document.id,
          targetDocumentId,
          ...(drafts[0] ? { targetDraftKey: drafts[0].targetKey } : {}),
          targetSource,
          transferScope,
          view,
        });

        deps.resumeTransferMutations(transferScope);
        const entry = getBookkeeping(transferId);
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
        forgetBookkeeping(transferId);
        logFilesPanelTransfer("error", "prepareSource failed", {
          panelId,
          transferId,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    async stageTarget({ panelId, prepared, transferId }) {
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

      const prior = getBookkeeping(transferId);
      rememberBookkeeping(transferId, {
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
      if (role === "target") {
        seedView({
          documentId: state.targetDocumentId,
          panelId,
          view: state.view,
        });
      }
    },

    async releaseSource({ remainingParams, transferId }) {
      const entry = getBookkeeping(transferId);
      if (!entry?.originalDraftKey) {
        return;
      }
      if (
        remainingReferencesSource(remainingParams, entry.sourceDocumentId, null)
      ) {
        return;
      }
      deps.removeFilesDraftRecord(entry.originalDraftKey);
    },

    async finalize({ outcome, role, transferId }) {
      const entry = getBookkeeping(transferId);
      if (entry?.transferScope) {
        deps.resumeTransferMutations(entry.transferScope);
        entry.transferScope = null;
      }

      if (outcome === "abort" && role === "target") {
        const targetEntry = takeBookkeeping(transferId);
        if (targetEntry?.createdTarget) {
          deps.discardDocument(targetEntry.targetDocumentId);
        } else if (targetEntry?.targetDraftKey) {
          deps.removeFilesDraftRecord(targetEntry.targetDraftKey);
        }
        return;
      }

      takeBookkeeping(transferId);
    },
  };
}
