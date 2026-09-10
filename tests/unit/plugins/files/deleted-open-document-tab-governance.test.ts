import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-09-files-deleted-open-document-tab-gold-standard.md";
const AGENTS = "AGENTS.md";
const DELETE = "src/plugins/builtin/files/renderer/tree/delete-action.ts";
const REDUCERS = "src/plugins/builtin/files/renderer/document/reducers.ts";
const LIVE_SYNC = "src/plugins/builtin/files/renderer/document/live-sync.ts";
const BAR = "src/plugins/builtin/files/renderer/panel/deleted-on-disk/bar.tsx";
const BODY = "src/plugins/builtin/files/renderer/panel/body.tsx";
const UNSAVED = "src/plugins/builtin/files/renderer/panel/tab/unsaved.ts";
const CLOSE_GUARD = "src/plugins/builtin/files/renderer/index.tsx";
const DISK_PROTECTION =
  "src/plugins/builtin/files/renderer/document/disk-protection.ts";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("deleted open document tab gold standard", () => {
  it("documents the contract in AGENTS.md and the 2026-09-09 spec", () => {
    const agents = read(AGENTS);
    const spec = read(SPEC);
    expect(agents).toContain("### Files 已删除文档与打开标签");
    expect(agents).toContain(
      "tests/unit/plugins/files/deleted-open-document-tab-governance.test.ts"
    );
    expect(agents).toContain("禁止因删除调用 `closeInstance`");
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("K4");
    expect(spec).toContain("diskConflict: false");
    expect(spec).toContain("isDeletionOnlyDirty");
    expect(spec).toContain("禁止在撤销栈补齐之前复活关 tab");
  });

  it("does not close the open tab when a tree delete succeeds", () => {
    const deleteAction = read(DELETE);
    expect(deleteAction).not.toContain("closeInstance");
    expect(deleteAction).not.toContain("closeOpenFilePanelsForDeletedPaths");
    expect(deleteAction).not.toContain("removeDocumentsAfterPathMutation");
    expect(deleteAction).toContain("markDocumentsDeletedOnDisk");
    expect(deleteAction).toContain("revertDocumentsToSaved");
  });

  it("marks deletion without treating it as a disk conflict", () => {
    const reducers = read(REDUCERS);
    const fnStart = reducers.indexOf(
      "export function withDocumentDeletedOnDisk"
    );
    const fn = reducers.slice(fnStart, fnStart + 800);
    expect(fn).toContain("deletedOnDisk: true");
    expect(fn).toContain("diskConflict: false");
    expect(fn).not.toContain("diskConflict: true");
  });

  it("does not auto-save while deletedOnDisk", () => {
    const liveSync = read(LIVE_SYNC);
    const scheduleStart = liveSync.indexOf(
      "export function scheduleDocumentAutoSave"
    );
    const schedule = liveSync.slice(
      scheduleStart,
      liveSync.indexOf(
        "export function clearDocumentAutoSaveTimer",
        scheduleStart
      )
    );
    expect(schedule).toContain("document.deletedOnDisk");
    expect(schedule).toContain("getDocument(document.id)");
    const storeChange = liveSync.slice(
      liveSync.indexOf("export function handleDocumentStoreChangeForLiveSync")
    );
    expect(storeChange).toContain("document.deletedOnDisk");
  });

  it("keeps the buffer visible behind compact chrome, not the conflict Empty", () => {
    const body = read(BODY);
    const bar = read(BAR);
    expect(body).toContain("FileDeletedOnDiskBar");
    expect(body).toContain("FileDeletedOnDiskChrome");
    expect(body).toContain("!document.deletedOnDisk");
    expect(bar).toContain("file-deleted-on-disk-chrome");
    expect(bar).toContain("filePanel.deleted.saveToRestore");
    expect(bar).toContain("FilesMutationSuspendedError");
    expect(bar).not.toContain("FileDiskConflictState");
  });

  it("does not treat deletion-only dirty as unsaved for tab or close", () => {
    expect(read(UNSAVED)).toContain("deletionOnlyDirty");
    expect(read(CLOSE_GUARD)).toContain("filesDocumentRequiresSaveOnClose");
    expect(read(DISK_PROTECTION)).toContain("filesDocumentRequiresSaveOnClose");
    expect(read(DISK_PROTECTION)).toContain("isDeletionOnlyDirty");
  });
});
