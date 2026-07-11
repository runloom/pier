import type {
  RendererPluginAction,
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { z } from "zod";
import type { FilesTranslate } from "./files-i18n.ts";
import { moveFilesTreeEntry } from "./files-tree-store.ts";

const treeItemMetadataSchema = z.object({
  kind: z.enum(["directory", "file"]),
  path: z.string().min(1),
  root: z.string().min(1),
  selectedPaths: z.array(z.string().min(1)).optional(),
  treeId: z.string().min(1).optional(),
});

const treeBackgroundMetadataSchema = z.object({
  root: z.string().min(1),
  treeId: z.string().min(1).optional(),
});

const editorTargetMetadataSchema = z.object({
  path: z.string().min(1),
  projectRoot: z.string().min(1).optional(),
  root: z.string().min(1),
  selectionEndLine: z.number().int().positive().optional(),
  selectionStartLine: z.number().int().positive().optional(),
});

export type FilesTreeItemMetadata = z.infer<typeof treeItemMetadataSchema>;
export type FilesTreeBackgroundMetadata = z.infer<
  typeof treeBackgroundMetadataSchema
>;
export type FilesEditorTargetMetadata = z.infer<
  typeof editorTargetMetadataSchema
>;

export function parseTreeMetadata(
  invocation: RendererPluginActionInvocation | undefined
): FilesTreeItemMetadata | null {
  const parsed = treeItemMetadataSchema.safeParse(invocation?.metadata);
  return parsed.success ? parsed.data : null;
}

export function parseTreeBackgroundMetadata(
  invocation: RendererPluginActionInvocation | undefined
): FilesTreeBackgroundMetadata | null {
  const parsed = treeBackgroundMetadataSchema.safeParse(invocation?.metadata);
  return parsed.success ? parsed.data : null;
}

export function parseEditorMetadata(
  invocation: RendererPluginActionInvocation | undefined
): FilesEditorTargetMetadata | null {
  const parsed = editorTargetMetadataSchema.safeParse(invocation?.metadata);
  return parsed.success ? parsed.data : null;
}

export function relativeToProjectRoot(
  root: string,
  path: string,
  projectRoot: string | undefined
): string {
  if (!projectRoot || projectRoot === root) {
    return path;
  }
  const rootPrefix = root.endsWith("/") ? root : `${root}/`;
  const projectPrefix = projectRoot.endsWith("/")
    ? projectRoot
    : `${projectRoot}/`;
  if (rootPrefix.startsWith(projectPrefix)) {
    const subRoot = rootPrefix.slice(projectPrefix.length);
    return `${subRoot}${path}`;
  }
  return path;
}

const TRAILING_SLASHES = /\/+$/;
const LEADING_SLASHES = /^\/+/;

export function joinAbsolutePath(root: string, path: string): string {
  const rootTrimmed = root.replace(TRAILING_SLASHES, "");
  const pathTrimmed = path.replace(LEADING_SLASHES, "");
  return pathTrimmed.length > 0 ? `${rootTrimmed}/${pathTrimmed}` : rootTrimmed;
}

export function dirnameRelative(path: string): string {
  const trimmed = path.replace(TRAILING_SLASHES, "");
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? "" : trimmed.slice(0, slash);
}

export function resolveCreateParentDir(options: {
  kind?: "directory" | "file";
  path?: string;
}): string {
  if (!options.path) {
    return "";
  }
  return options.kind === "directory"
    ? options.path
    : dirnameRelative(options.path);
}

export function basename(path: string): string {
  const trimmed = path.replace(TRAILING_SLASHES, "");
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: NUL is a required file-name safeguard here.
const INVALID_NAME_PATTERN = /[\u0000/\\]/;

export function validateName(name: string, t: FilesTranslate): string | null {
  if (name.length === 0) {
    return t("filePanel.tree.nameRequired", "Name required");
  }
  if (name === "." || name === "..") {
    return t("filePanel.tree.nameReserved", "Reserved name");
  }
  if (INVALID_NAME_PATTERN.test(name)) {
    return t(
      "filePanel.tree.nameInvalidChars",
      "Name cannot contain / \\ or NUL"
    );
  }
  return null;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: NUL is a required path safeguard.
const INVALID_PATH_CHAR_PATTERN = /[\u0000\\]/;

/** 允许 `a/b/c.ts` 相对嵌套路径;禁绝对路径、`..`、空段、反斜杠与 NUL。 */
export function validateRelativePath(
  path: string,
  t: FilesTranslate
): string | null {
  if (path.length === 0) {
    return t("filePanel.tree.nameRequired", "Name required");
  }
  if (path.startsWith("/") || path.startsWith("~")) {
    return t(
      "filePanel.tree.pathMustBeRelative",
      "Path must be relative to the parent folder"
    );
  }
  if (INVALID_PATH_CHAR_PATTERN.test(path)) {
    return t(
      "filePanel.tree.pathInvalidChars",
      "Path cannot contain \\ or NUL"
    );
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      return t(
        "filePanel.tree.pathEmptySegment",
        "Path cannot contain empty segments"
      );
    }
    if (segment === "." || segment === "..") {
      return t("filePanel.tree.nameReserved", "Reserved name");
    }
  }
  return null;
}

export async function writeClipboardText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function pluginAction(action: {
  category: string;
  handler: RendererPluginAction["handler"];
  id: string;
  metadata?: RendererPluginAction["metadata"];
  surfaces: readonly string[];
  title: () => string;
}): RendererPluginAction {
  return {
    category: action.category,
    handler: action.handler,
    id: action.id,
    ...(action.metadata ? { metadata: action.metadata } : {}),
    surfaces: action.surfaces,
    title: action.title,
  };
}

export function notifyMoveWithUndo(
  context: RendererPluginContext,
  t: FilesTranslate,
  root: string,
  fromPath: string,
  toPath: string,
  onDocumentMove: (
    root: string,
    fromPath: string,
    toPath: string
  ) => Promise<void> | void
): void {
  const name = basename(toPath);
  context.notifications.success(t("filePanel.tree.moved", `Moved "${name}"`), {
    action: {
      label: t("filePanel.tree.undo", "Undo"),
      onClick: () => {
        Promise.resolve(onDocumentMove(root, toPath, fromPath))
          .then(async () => {
            moveFilesTreeEntry(root, toPath, fromPath);
          })
          .catch((error: unknown) => {
            context.dialogs
              .alert({
                body: error instanceof Error ? error.message : String(error),
                size: "default",
                title: t("filePanel.tree.renameFailed", "Unable to rename"),
              })
              .catch(() => undefined);
          });
      },
    },
  });
}
