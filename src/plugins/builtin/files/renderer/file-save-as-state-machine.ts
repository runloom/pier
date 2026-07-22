import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  FileDocumentExpectedState,
  FileDocumentWriteResult,
} from "@shared/contracts/file.ts";
import type { FileSaveTarget } from "@shared/contracts/file-save-target.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { FileSaveFeedback } from "./file-save-feedback.ts";
import { flushFilesDraftWrites } from "./files-document-drafts.ts";
import {
  adoptDocumentSaveAsTarget,
  getDocument,
  getDocumentForPanelSource,
} from "./files-document-store.ts";
import type { FilesDocumentPanelSource } from "./files-document-types.ts";
import {
  createSaveAsJournal,
  markSaveAsJournalWritten,
  removeSaveAsJournal,
  type SaveAsJournalRecord,
  saveAsJournalForDocument,
  saveAsWriteReceipt,
} from "./files-save-as-journal.ts";

export type FileSaveAsResult =
  | { kind: "cancelled" }
  | { kind: "failed" }
  | {
      documentId: string;
      kind: "saved";
      source: Extract<FilesDocumentPanelSource, { kind: "disk" }>;
      target: FileSaveTarget;
    };

const saveAsRecoveryOperations = new Map<string, Promise<boolean>>();

function isSameDiskTarget(
  source: FilesDocumentPanelSource,
  target: FileSaveTarget
): boolean {
  return (
    source.kind === "disk" &&
    source.root === target.root &&
    source.path === target.path
  );
}

function preparedJournalMatchesText(
  journal: SaveAsJournalRecord,
  result: Awaited<ReturnType<RendererPluginContext["files"]["readDocument"]>>
): result is Extract<typeof result, { kind: "text" }> {
  if (
    result.kind !== "text" ||
    result.contents !== journal.savedContents ||
    result.format.encoding !== journal.format.encoding ||
    result.format.bom !== journal.format.bom
  ) {
    return false;
  }
  const expectedEol = journal.savedContents.includes("\n")
    ? journal.eol
    : "none";
  return result.eol === expectedEol;
}

async function recoverPreparedWrite(
  context: RendererPluginContext,
  journal: SaveAsJournalRecord
): Promise<Extract<FileDocumentWriteResult, { kind: "written" }> | null> {
  const result = await context.files.readDocument({
    path: journal.target.path,
    root: journal.target.root,
  });
  if (!preparedJournalMatchesText(journal, result)) {
    return null;
  }
  const confirmation = await context.files.confirmDurability({
    expectedRevision: result.revision,
    path: journal.target.path,
    root: journal.target.root,
  });
  if (confirmation.kind === "revision-mismatch") {
    return null;
  }
  if (confirmation.kind === "failed") {
    throw new Error(confirmation.message);
  }
  const targetStat = await context.files.stat({
    path: journal.target.path,
    root: journal.target.root,
  });
  if (!(targetStat.exists && targetStat.mtimeMs !== null)) {
    return null;
  }
  return {
    canonicalPath: result.canonicalPath,
    committed: true,
    durability: "confirmed",
    kind: "written",
    mode: result.mode,
    mtimeMs: targetStat.mtimeMs,
    revision: confirmation.revision,
    size: result.size,
  };
}

export async function saveDocumentAs(input: {
  context: RendererPluginContext;
  documentId: string;
  feedback?: FileSaveFeedback;
  initiator?: { groupId?: string; panelId: string };
  onCommitted?: (
    result: Extract<FileSaveAsResult, { kind: "saved" }>
  ) => Promise<void> | void;
  panelContext: PanelContext;
}): Promise<FileSaveAsResult> {
  const { context, documentId, panelContext } = input;
  const t = (key: string, fallback: string) =>
    context.i18n.t(key, undefined, fallback);
  const initial = getDocument(documentId);
  if (
    !(initial?.format && initial.eol) ||
    initial.eol === "mixed" ||
    initial.readOnly
  ) {
    return { kind: "failed" };
  }
  if (saveAsJournalForDocument(documentId)) {
    let recoveredResult: Extract<FileSaveAsResult, { kind: "saved" }> | null =
      null;
    const recovered = await recoverDocumentSaveAs({
      context,
      documentId,
      ...(input.initiator ? { panelId: input.initiator.panelId } : {}),
      onCommitted: async (result) => {
        await input.onCommitted?.(result);
        recoveredResult = result;
      },
    });
    if (recovered && recoveredResult) {
      return recoveredResult;
    }
    if (saveAsJournalForDocument(documentId)) {
      return { kind: "failed" };
    }
  }
  let committed = false;
  let journal: SaveAsJournalRecord | null = null;
  try {
    const target = await context.files.pickSaveTarget({
      context: panelContext,
      suggestedName: initial.name,
    });
    if (!target) {
      return { kind: "cancelled" };
    }
    const targetSource = {
      kind: "disk" as const,
      path: target.path,
      root: target.root,
    };
    const openTarget = getDocumentForPanelSource(targetSource);
    const openTargetSnapshot =
      openTarget && openTarget.id !== initial.id
        ? {
            currentContents: openTarget.currentContents,
            dirty: openTarget.dirty,
            durabilityUnknown: openTarget.durabilityUnknown,
            id: openTarget.id,
            needsSaveAs: openTarget.needsSaveAs,
          }
        : null;
    if (
      openTarget &&
      openTarget.id !== initial.id &&
      (openTarget.dirty ||
        openTarget.durabilityUnknown ||
        openTarget.needsSaveAs)
    ) {
      if (input.feedback !== "none")
        await context.dialogs.alert({
          body: t(
            "filePanel.saveAs.targetDirty",
            "The selected target already has protected unsaved changes."
          ),
          title: t("filePanel.saveAs.failed", "Unable to save as"),
        });
      return { kind: "failed" };
    }
    const inspection = await context.files.inspectWriteTarget({
      path: target.path,
      root: target.root,
    });
    let expected: FileDocumentExpectedState;
    if (inspection.kind === "absent") {
      expected = { kind: "absent" };
    } else if (inspection.kind === "existing") {
      if (isSameDiskTarget(initial.source, target)) {
        if (!initial.revision) {
          throw new Error(
            t(
              "filePanel.saveAs.targetChanged",
              "The selected target changed before it could be written."
            )
          );
        }
        expected = { kind: "revision", revision: initial.revision };
      } else {
        const overwrite = await context.dialogs.confirm({
          body: t(
            "filePanel.saveAs.overwriteBody",
            "A file already exists at the selected location. Overwrite it?"
          ),
          cancelLabel: t("filePanel.saveAs.cancel", "Cancel"),
          confirmLabel: t("filePanel.saveAs.overwrite", "Overwrite"),
          intent: "destructive",
          size: "sm",
          title: t("filePanel.saveAs.overwriteTitle", "Replace existing file"),
        });
        if (!overwrite) {
          return { kind: "cancelled" };
        }
        expected = { kind: "revision", revision: inspection.revision };
      }
    } else {
      throw new Error(
        inspection.kind === "not-writable"
          ? inspection.message
          : t(
              "filePanel.errors.unsupportedOverwrite",
              "This file type cannot be overwritten safely."
            )
      );
    }
    const latest = getDocument(documentId);
    if (!(latest?.format && latest.eol) || latest.eol === "mixed") {
      return { kind: "cancelled" };
    }
    const savedContents = latest.currentContents;
    const latestOpenTarget = getDocumentForPanelSource(targetSource);
    if (
      latestOpenTarget &&
      latestOpenTarget.id !== initial.id &&
      (latestOpenTarget.dirty ||
        latestOpenTarget.durabilityUnknown ||
        latestOpenTarget.needsSaveAs ||
        !openTargetSnapshot ||
        latestOpenTarget.id !== openTargetSnapshot.id ||
        latestOpenTarget.currentContents !==
          openTargetSnapshot.currentContents ||
        latestOpenTarget.dirty !== openTargetSnapshot.dirty ||
        latestOpenTarget.durabilityUnknown !==
          openTargetSnapshot.durabilityUnknown ||
        latestOpenTarget.needsSaveAs !== openTargetSnapshot.needsSaveAs)
    ) {
      if (input.feedback !== "none")
        await context.dialogs.alert({
          body: t(
            "filePanel.saveAs.targetDirty",
            "The selected target already has protected unsaved changes."
          ),
          title: t("filePanel.saveAs.failed", "Unable to save as"),
        });
      return { kind: "failed" };
    }
    const source: FilesDocumentPanelSource =
      initial.source.kind === "disk"
        ? initial.source
        : {
            id: initial.source.id,
            kind: "untitled",
            name: initial.name,
          };
    journal = createSaveAsJournal({
      eol: latest.eol === "none" ? "lf" : latest.eol,
      format: latest.format,
      ...(input.initiator?.groupId
        ? { panelGroupId: input.initiator.groupId }
        : {}),
      ...(input.initiator ? { panelId: input.initiator.panelId } : {}),
      savedContents,
      source,
      sourceDocumentId: documentId,
      target,
    });
    await flushFilesDraftWrites();
    const result = await context.files.writeDocument({
      contents: savedContents,
      eol: latest.eol === "none" ? "lf" : latest.eol,
      expected,
      format: latest.format,
      operationId: journal.operationId,
      path: target.path,
      root: target.root,
    });
    if (result.kind === "conflict") {
      throw new Error(
        t(
          "filePanel.saveAs.targetChanged",
          "The selected target changed before it could be written."
        )
      );
    }
    if (result.kind === "not-writable") {
      throw new Error(result.message);
    }
    committed = true;
    journal = markSaveAsJournalWritten(journal, result);
    await flushFilesDraftWrites();
    const targetDocument = adoptDocumentSaveAsTarget({
      result,
      savedContents,
      sourceDocumentId: documentId,
      target,
    });
    if (targetDocument.dirty || targetDocument.durabilityUnknown) {
      await flushFilesDraftWrites();
    }
    const savedResult: Extract<FileSaveAsResult, { kind: "saved" }> = {
      documentId: targetDocument.id,
      kind: "saved",
      source: targetSource,
      target,
    };
    await input.onCommitted?.(savedResult);
    removeSaveAsJournal(journal);
    await flushFilesDraftWrites();
    return savedResult;
  } catch (error) {
    if (!committed && journal) {
      removeSaveAsJournal(journal);
      await flushFilesDraftWrites().catch(() => undefined);
    }
    if (input.feedback !== "none")
      await context.dialogs.alert({
        body: error instanceof Error ? error.message : String(error),
        title: committed
          ? t(
              "filePanel.saveAs.rebindFailed",
              "File saved, but it could not be opened in the editor"
            )
          : t("filePanel.saveAs.failed", "Unable to save as"),
      });
    return { kind: "failed" };
  }
}

export async function recoverDocumentSaveAs(input: {
  context: RendererPluginContext;
  documentId: string;
  panelId?: string;
  onCommitted: (
    result: Extract<FileSaveAsResult, { kind: "saved" }>
  ) => Promise<void> | void;
}): Promise<boolean> {
  const journal = saveAsJournalForDocument(input.documentId);
  if (!journal) {
    return false;
  }
  if (journal.panelId && journal.panelId !== input.panelId) {
    return false;
  }
  const existing = saveAsRecoveryOperations.get(journal.operationId);
  if (existing) {
    return await existing;
  }
  const operation = (async () => {
    let recoveryJournal = journal;
    if (recoveryJournal.phase === "prepared") {
      const recoveredWrite =
        saveAsWriteReceipt(recoveryJournal) ??
        (await recoverPreparedWrite(input.context, recoveryJournal));
      if (!recoveredWrite) {
        removeSaveAsJournal(recoveryJournal);
        await flushFilesDraftWrites();
        return false;
      }
      recoveryJournal = markSaveAsJournalWritten(
        recoveryJournal,
        recoveredWrite
      );
      await flushFilesDraftWrites();
    }
    if (!recoveryJournal.writtenResult) {
      removeSaveAsJournal(recoveryJournal);
      await flushFilesDraftWrites();
      return false;
    }
    const inspection = await input.context.files.inspectWriteTarget({
      path: recoveryJournal.target.path,
      root: recoveryJournal.target.root,
    });
    if (
      inspection.kind !== "existing" ||
      inspection.revision !== recoveryJournal.writtenResult.revision
    ) {
      removeSaveAsJournal(recoveryJournal);
      await flushFilesDraftWrites();
      await input.context.dialogs.alert({
        body: input.context.i18n.t(
          "filePanel.saveAs.recoveryTargetChanged",
          undefined,
          "A file written by an interrupted Save As operation changed before the editor could recover it. The source draft was kept."
        ),
        title: input.context.i18n.t(
          "filePanel.saveAs.rebindFailed",
          undefined,
          "File saved, but it could not be opened in the editor"
        ),
      });
      return false;
    }
    if (!getDocument(recoveryJournal.sourceDocumentId)) {
      removeSaveAsJournal(recoveryJournal);
      await flushFilesDraftWrites();
      return false;
    }
    const source = {
      kind: "disk" as const,
      path: recoveryJournal.target.path,
      root: recoveryJournal.target.root,
    };
    const targetDocument = adoptDocumentSaveAsTarget({
      result: recoveryJournal.writtenResult,
      savedContents: recoveryJournal.savedContents,
      sourceDocumentId: recoveryJournal.sourceDocumentId,
      target: recoveryJournal.target,
    });
    const result: Extract<FileSaveAsResult, { kind: "saved" }> = {
      documentId: targetDocument.id,
      kind: "saved",
      source,
      target: recoveryJournal.target,
    };
    await input.onCommitted(result);
    removeSaveAsJournal(recoveryJournal);
    await flushFilesDraftWrites();
    return true;
  })().finally(() => {
    saveAsRecoveryOperations.delete(journal.operationId);
  });
  saveAsRecoveryOperations.set(journal.operationId, operation);
  return await operation;
}
