import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FilePathMutationGuard } from "./file-path-mutation-guard.ts";
import { isSamePathOrDescendant } from "./files-document-paths.ts";
import type { FilesDocument } from "./files-document-types.ts";
import { moveFilesNavPath } from "./files-nav-history.ts";

export async function moveEditorPath(input: {
  context: Pick<RendererPluginContext, "files">;
  beginMove: (
    root: string,
    oldPath: string,
    newPath: string
  ) => Promise<FilePathMutationGuard>;
  moveDiskDocumentSource: (
    root: string,
    oldPath: string,
    newPath: string,
    affectedDocuments?: readonly FilesDocument[]
  ) => Promise<void>;
  newPath: string;
  oldPath: string;
  prepare: (documents: readonly FilesDocument[]) => void;
  root: string;
}): Promise<void> {
  const guard = await input.beginMove(input.root, input.oldPath, input.newPath);
  try {
    const affected = guard.currentDocuments();
    const protectedTarget = affected.find(
      (document) =>
        document.source.kind === "disk" &&
        document.source.root === input.root &&
        isSamePathOrDescendant(document.source.path, input.newPath) &&
        (document.dirty || document.durabilityUnknown || document.needsSaveAs)
    );
    if (protectedTarget) {
      throw new Error("The move target has protected unsaved changes");
    }
    input.prepare(affected);
    await input.context.files.move({
      newPath: input.newPath,
      path: input.oldPath,
      root: input.root,
    });
    await input.moveDiskDocumentSource(
      input.root,
      input.oldPath,
      input.newPath,
      guard.currentDocuments()
    );
    moveFilesNavPath(input.root, input.oldPath, input.newPath);
  } finally {
    guard.release();
  }
}
