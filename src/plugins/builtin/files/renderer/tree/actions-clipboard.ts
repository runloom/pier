import type {
  RendererPluginAction,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import {
  FILES_FILE_CLIPBOARD_COPY_COMMAND_ID,
  FILES_FILE_CLIPBOARD_CUT_COMMAND_ID,
  FILES_FILE_CLIPBOARD_PASTE_COMMAND_ID,
} from "../../manifest.ts";
import type { FilesTranslate } from "../i18n.ts";
import {
  parseTreeBackgroundMetadata,
  parseTreeMetadata,
  pluginAction,
} from "./action-utils.ts";
import {
  basenameRelative,
  clearFilesTreeClipboard,
  type FilesTreeClipboardEntry,
  hasFilesTreeClipboard,
  isPasteIntoSelfOrDescendant,
  joinRelativeChild,
  pruneNestedClipboardEntries,
  readFilesTreeClipboard,
  resolvePasteParentDir,
  writeFilesTreeClipboard,
} from "./file-clipboard.ts";
import { addFilesTreeEntry, moveFilesTreeEntry } from "./store.ts";

function selectionPaths(
  path: string,
  selectedPaths: readonly string[] | undefined
): string[] {
  if (
    selectedPaths &&
    selectedPaths.length > 1 &&
    selectedPaths.includes(path)
  ) {
    return [...selectedPaths];
  }
  return [path];
}

async function uniqueDestinationPath(
  context: RendererPluginContext,
  root: string,
  parentDir: string,
  preferredName: string
): Promise<string> {
  const stemDot = preferredName.lastIndexOf(".");
  const stem = stemDot > 0 ? preferredName.slice(0, stemDot) : preferredName;
  const ext = stemDot > 0 ? preferredName.slice(stemDot) : "";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let name = preferredName;
    if (attempt === 1) {
      name = `${stem} copy${ext}`;
    } else if (attempt > 1) {
      name = `${stem} copy ${attempt}${ext}`;
    }
    const candidate = joinRelativeChild(parentDir, name);
    const { exists } = await context.files.exists({
      path: candidate,
      root,
    });
    if (!exists) {
      return candidate;
    }
  }
  throw new Error("name conflict");
}

function createCutOrCopyAction(
  mode: "copy" | "cut",
  actionId: string,
  context: RendererPluginContext,
  t: FilesTranslate
): RendererPluginAction {
  return pluginAction({
    id: actionId,
    category: "file",
    metadata: {
      group: "5_edit",
      sortOrder: mode === "cut" ? 3 : 4,
    },
    surfaces: ["files/tree-item"],
    title: () =>
      mode === "cut"
        ? t("filePanel.tree.action.cut", "Cut")
        : t("filePanel.tree.action.copy", "Copy"),
    handler: (invocation) => {
      const target = parseTreeMetadata(invocation);
      if (!target) {
        return;
      }
      const paths = selectionPaths(target.path, target.selectedPaths);
      const kindsRaw = invocation?.metadata?.entryKinds;
      const entryKinds =
        kindsRaw && typeof kindsRaw === "object" && !Array.isArray(kindsRaw)
          ? (kindsRaw as Record<string, unknown>)
          : {};
      // 优先用树菜单传入的 entryKinds；否则焦点 kind + 前缀启发。
      const rawEntries: FilesTreeClipboardEntry[] = paths.map((path) => {
        const declared = entryKinds[path];
        if (declared === "directory" || declared === "file") {
          return { kind: declared, path };
        }
        if (path === target.path) {
          return { kind: target.kind, path };
        }
        const isDir = paths.some(
          (other) => other !== path && other.startsWith(`${path}/`)
        );
        return {
          kind: isDir ? ("directory" as const) : ("file" as const),
          path,
        };
      });
      // 父+子同选时只保留祖先，避免 cut/copy 双计或源已搬走。
      const entries = pruneNestedClipboardEntries(rawEntries);
      writeFilesTreeClipboard({
        entries,
        mode,
        root: target.root,
      });
      context.notifications.success(
        mode === "cut"
          ? t("filePanel.tree.cutReady", "Ready to move")
          : t("filePanel.tree.copyReady", "Ready to paste")
      );
    },
  });
}

export function createFileClipboardCutAction(
  context: RendererPluginContext,
  t: FilesTranslate
): RendererPluginAction {
  return createCutOrCopyAction(
    "cut",
    FILES_FILE_CLIPBOARD_CUT_COMMAND_ID,
    context,
    t
  );
}

export function createFileClipboardCopyAction(
  context: RendererPluginContext,
  t: FilesTranslate
): RendererPluginAction {
  return createCutOrCopyAction(
    "copy",
    FILES_FILE_CLIPBOARD_COPY_COMMAND_ID,
    context,
    t
  );
}

export function createFileClipboardPasteAction(
  context: RendererPluginContext,
  t: FilesTranslate
): RendererPluginAction {
  return pluginAction({
    id: FILES_FILE_CLIPBOARD_PASTE_COMMAND_ID,
    category: "file",
    metadata: {
      group: "5_edit",
      menuHidden: () => !hasFilesTreeClipboard(),
      sortOrder: 5,
    },
    surfaces: ["files/tree-item", "files/tree-background"],
    title: () => t("filePanel.tree.action.paste", "Paste"),
    handler: async (invocation) => {
      const clip = readFilesTreeClipboard();
      if (!clip) {
        return;
      }
      const treeItem = parseTreeMetadata(invocation);
      const background = parseTreeBackgroundMetadata(invocation);
      const root = treeItem?.root ?? background?.root;
      if (!root || root !== clip.root) {
        context.notifications.error(
          t(
            "filePanel.tree.pasteWrongProject",
            "Can only paste within the same project."
          )
        );
        return;
      }
      const parentDir = resolvePasteParentDir({
        ...(treeItem?.kind === undefined ? {} : { kind: treeItem.kind }),
        ...(treeItem?.path === undefined ? {} : { path: treeItem.path }),
      });
      // cut/copy 均禁止粘贴到自身或子孙（预检，避免半成功）。
      for (const entry of clip.entries) {
        if (isPasteIntoSelfOrDescendant(parentDir, entry.path)) {
          context.notifications.error(
            t(
              "filePanel.tree.pasteIntoSelf",
              "Can't paste a folder into itself."
            )
          );
          return;
        }
      }

      let pending =
        clip.mode === "cut"
          ? clip.entries.map((entry) => ({ ...entry }))
          : [...clip.entries];
      let successCount = 0;
      const errors: { message: string; path: string }[] = [];

      for (const entry of clip.entries) {
        try {
          const name = basenameRelative(entry.path);
          const dest = await uniqueDestinationPath(
            context,
            root,
            parentDir,
            name
          );
          if (clip.mode === "cut") {
            await context.files.move({
              newPath: dest,
              path: entry.path,
              root,
            });
            moveFilesTreeEntry(root, entry.path, dest);
            pending = pending.filter((item) => item.path !== entry.path);
            // 成功即从剪贴板剔除，避免半失败后 Retry 再搬已搬走的源。
            if (pending.length === 0) {
              clearFilesTreeClipboard();
            } else {
              writeFilesTreeClipboard({
                entries: pending,
                mode: "cut",
                root: clip.root,
              });
            }
          } else {
            await context.files.copy({
              newPath: dest,
              path: entry.path,
              root,
            });
            addFilesTreeEntry(root, {
              kind: entry.kind,
              path: dest,
              root,
            });
          }
          successCount += 1;
        } catch (error) {
          errors.push({
            message: error instanceof Error ? error.message : String(error),
            path: entry.path,
          });
        }
      }

      if (errors.length === 0) {
        if (clip.mode === "cut") {
          clearFilesTreeClipboard();
        }
        context.notifications.success(
          t("filePanel.tree.pasteDone", "Paste complete")
        );
        return;
      }

      if (successCount > 0) {
        await context.dialogs.alert({
          body: errors
            .map((item) => `${item.path}\n${item.message}`)
            .join("\n\n"),
          title: t(
            "filePanel.tree.pastePartial",
            "Pasted {{done}} of {{total}}; some items failed.",
            {
              done: successCount,
              total: clip.entries.length,
            }
          ),
        });
        return;
      }

      await context.dialogs.alert({
        body: errors
          .map((item) => `${item.path}\n${item.message}`)
          .join("\n\n"),
        title: t("filePanel.tree.pasteFailed", "Couldn't paste"),
      });
    },
  });
}
