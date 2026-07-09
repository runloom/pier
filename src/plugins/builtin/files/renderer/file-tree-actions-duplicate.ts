import type {
  RendererPluginAction,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { FILES_DUPLICATE_COMMAND_ID } from "../manifest.ts";
import {
  basename,
  dirnameRelative,
  parseTreeMetadata,
  pluginAction,
} from "./file-tree-action-utils.ts";
import type { FilesTranslate } from "./files-i18n.ts";
import { addFilesTreeEntry } from "./files-tree-store.ts";

// "name.ext" → "name copy.ext" → "name copy 2.ext"(与 Finder 语义一致)。
function duplicateCandidatePath(path: string, attempt: number): string {
  const dir = dirnameRelative(path);
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const suffix = attempt === 1 ? " copy" : ` copy ${attempt}`;
  const candidate = `${stem}${suffix}${ext}`;
  return dir.length > 0 ? `${dir}/${candidate}` : candidate;
}

export function createDuplicateAction(
  context: RendererPluginContext,
  t: FilesTranslate
): RendererPluginAction {
  return pluginAction({
    id: FILES_DUPLICATE_COMMAND_ID,
    category: "file",
    metadata: { group: "5_edit", sortOrder: 2 },
    surfaces: ["files/tree-item"],
    title: () => t("filePanel.tree.action.duplicate", "Duplicate"),
    handler: async (invocation) => {
      const target = parseTreeMetadata(invocation);
      if (!target) {
        return;
      }
      try {
        let newPath = "";
        for (let attempt = 1; attempt <= 50; attempt += 1) {
          const candidate = duplicateCandidatePath(target.path, attempt);
          const { exists } = await context.files.exists({
            path: candidate,
            root: target.root,
          });
          if (!exists) {
            newPath = candidate;
            break;
          }
        }
        if (!newPath) {
          throw new Error(
            t("filePanel.tree.duplicateFailed", "Unable to duplicate item")
          );
        }
        await context.files.copy({
          newPath,
          path: target.path,
          root: target.root,
        });
        addFilesTreeEntry(target.root, {
          kind: target.kind,
          path: newPath,
          root: target.root,
        });
      } catch (error) {
        context.notifications.error(
          error instanceof Error
            ? error.message
            : t("filePanel.tree.duplicateFailed", "Unable to duplicate item")
        );
      }
    },
  });
}
