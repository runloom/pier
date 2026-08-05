import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { isSamePathOrDescendant } from "../document/paths.ts";
import type { FilesDocument } from "../document/types.ts";
import type { FilePathMutationGuard } from "../mutation/path-guard.ts";

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
  } finally {
    guard.release();
  }
}
