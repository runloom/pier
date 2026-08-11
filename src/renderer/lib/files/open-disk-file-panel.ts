import { notifyFilesDiskPathOpened } from "@plugins/api/files-disk-path-opened.ts";
import { nonEmptyFileRootRelativePathSchema } from "@shared/contracts/file.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { openPluginPanelInstance } from "../plugins/host/panel-instance-open.ts";
import { getPluginPanelRegistrations } from "../plugins/panel-registry.ts";

/** 与 files 插件 `FILES_FILE_PANEL_ID` 对齐；宿主不 import 插件包。 */
export const FILES_FILE_PANEL_COMPONENT_ID = "pier.files.filePanel";

export type {
  FilesDiskPathOpenedEvent,
  FilesDiskPathOpenedListener,
} from "@plugins/api/files-disk-path-opened.ts";
export { onFilesDiskPathOpened } from "@plugins/api/files-disk-path-opened.ts";

const HASH_MULTIPLIER = 33;
const HASH_MODULUS = 2_147_483_647;
const HASH_SEED = 5381;

function stableFileIdentityHash(input: string): string {
  let hash = HASH_SEED;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * HASH_MULTIPLIER + input.charCodeAt(index)) % HASH_MODULUS;
  }
  return hash.toString(36);
}

function createFilePanelNonce(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return stableFileIdentityHash(`${Date.now()}\u0000${Math.random()}`);
}

function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDiskSource(
  value: unknown
): value is { kind: "disk"; path: string; root: string } {
  if (!isRecord(value) || value.kind !== "disk") {
    return false;
  }
  return (
    typeof value.path === "string" &&
    value.path.length > 0 &&
    typeof value.root === "string" &&
    value.root.length > 0
  );
}

function parseDiskSourceFromParams(
  params: unknown
): { kind: "disk"; path: string; root: string } | null {
  if (!(isRecord(params) && "source" in params)) {
    return null;
  }
  return isDiskSource(params.source) ? params.source : null;
}

function sameDiskSource(
  left: { path: string; root: string },
  right: { path: string; root: string }
): boolean {
  return left.root === right.root && left.path === right.path;
}

function cloneParamsRecord(params: unknown): Record<string, unknown> | null {
  if (!isRecord(params)) {
    return null;
  }
  return { ...params };
}

/**
 * 宿主跨插件打开 files 磁盘文档面板。
 * files 未注册 / path 非法时返回 false；已打开同 source 时复用实例。
 */
export function openFilesDiskPath(input: {
  column?: number;
  context?: PanelContext;
  /** 1-based working-tree line; forwarded to files via open event. */
  line?: number;
  /** Heading id / fragment for Markdown preview scroll. */
  markdownAnchor?: string;
  path: string;
  /** Prefer Markdown preview mode after open (files plugin consumes via open event). */
  preferPreview?: boolean;
  root: string;
  title?: string;
}): boolean {
  const pathParsed = nonEmptyFileRootRelativePathSchema.safeParse(input.path);
  if (!(pathParsed.success && input.root.length > 0)) {
    return false;
  }

  if (!getPluginPanelRegistrations().has(FILES_FILE_PANEL_COMPONENT_ID)) {
    return false;
  }

  const source = {
    kind: "disk" as const,
    path: pathParsed.data,
    root: input.root,
  };
  const api = useWorkspaceStore.getState().api;
  const existing = api?.panels.find((panel) => {
    if (panel.view.contentComponent !== FILES_FILE_PANEL_COMPONENT_ID) {
      return false;
    }
    const existingSource = parseDiskSourceFromParams(panel.params);
    return existingSource !== null && sameDiskSource(existingSource, source);
  });

  const existingParams = cloneParamsRecord(existing?.params);
  // Always refresh disk source on open so params match the request path even
  // when reusing an instance (identity key is path-scoped today).
  // Preview reveal: heading id and/or line (line used when no heading).
  const wantsPreviewReveal =
    input.preferPreview === true &&
    (input.markdownAnchor !== undefined ||
      (input.line !== undefined && input.line >= 1));
  const anchorRequestId = wantsPreviewReveal
    ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    : undefined;
  const lineOnlyReveal =
    input.preferPreview === true &&
    input.markdownAnchor === undefined &&
    input.line !== undefined &&
    input.line >= 1;
  const params = {
    ...(existingParams ?? { pinned: true }),
    source,
    // Clear stale line-only reveal when this open uses a heading anchor.
    ...(input.markdownAnchor === undefined
      ? {}
      : {
          markdownAnchor: input.markdownAnchor,
          markdownAnchorRequestId: anchorRequestId,
          markdownRevealLine: undefined,
        }),
    ...(lineOnlyReveal
      ? {
          markdownAnchor: undefined,
          markdownAnchorRequestId: anchorRequestId,
          markdownRevealLine: input.line,
        }
      : {}),
  };
  const identityKey = `${FILES_FILE_PANEL_COMPONENT_ID}:disk:${stableFileIdentityHash(
    `${source.root}\u0000${source.path}`
  )}`;
  const instanceId = existing?.id ?? `${identityKey}:${createFilePanelNonce()}`;

  const result = openPluginPanelInstance({
    componentId: FILES_FILE_PANEL_COMPONENT_ID,
    // Always refresh context when caller provides one — reusing an existing
    // instance used to drop context and trip outside-workspace restore.
    ...(input.context ? { context: input.context } : {}),
    dropUnpinnedInstances: !existing,
    instanceId,
    params,
    title: input.title ?? basename(source.path),
  });
  if (result.kind === "opened") {
    notifyFilesDiskPathOpened({
      instanceId,
      path: source.path,
      root: source.root,
      ...(input.column === undefined ? {} : { column: input.column }),
      ...(input.line === undefined ? {} : { line: input.line }),
      ...(input.preferPreview === true ? { preferPreview: true } : {}),
      ...(input.markdownAnchor === undefined
        ? {}
        : { markdownAnchor: input.markdownAnchor }),
    });
  }
  return result.kind === "opened";
}
