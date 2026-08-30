import { notifyFilesDiskPathOpened } from "@plugins/api/files-disk-path-opened.ts";
import type { PierCommandPlacement } from "@shared/contracts/commands.ts";
import { nonEmptyFileRootRelativePathSchema } from "@shared/contracts/file.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { openPluginPanelInstance } from "../plugins/host/panel-instance-open.ts";
import { getPluginPanelRegistrations } from "../plugins/panel-registry.ts";
import {
  parseFilesDiskSourceFromParams,
  sameFilesDiskSource,
} from "./disk-source.ts";
import { stableFileIdentityHash } from "./identity-hash.ts";

/** 与 files 插件 `FILES_FILE_PANEL_ID` 对齐；宿主不 import 插件包。 */
export const FILES_FILE_PANEL_COMPONENT_ID = "pier.files.filePanel";

export type {
  FilesDiskPathOpenedEvent,
  FilesDiskPathOpenedListener,
} from "@plugins/api/files-disk-path-opened.ts";
export { onFilesDiskPathOpened } from "@plugins/api/files-disk-path-opened.ts";

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

function cloneParamsRecord(params: unknown): Record<string, unknown> | null {
  if (!isRecord(params)) {
    return null;
  }
  return { ...params };
}

export interface OpenFilesDiskPathInput {
  canvasRevealAnchor?: string;
  column?: number;
  context?: PanelContext;
  line?: number;
  markdownAnchor?: string;
  path: string;
  placement?: PierCommandPlacement;
  preferPreview?: boolean;
  referencePanelId?: string;
  revealTree?: boolean;
  root: string;
  title?: string;
}

export type OpenFilesDiskPathCommandResult =
  | { ok: true; panelId: string; reused: boolean }
  | {
      ok: false;
      reason: "files-unregistered" | "invalid-path" | "open-failed";
    };

/**
 * 宿主跨插件打开 files 磁盘文档面板。
 * files 未注册 / path 非法时返回 false；已打开同 source 时复用实例。
 */
export function openFilesDiskPath(input: OpenFilesDiskPathInput): boolean {
  return openFilesDiskPathResult(input).ok;
}

export function openFilesDiskPathForCommand(
  input: OpenFilesDiskPathInput
): OpenFilesDiskPathCommandResult {
  return openFilesDiskPathResult(input);
}

function previewRevealParams(input: OpenFilesDiskPathInput) {
  const wantsPreviewReveal =
    input.preferPreview === true &&
    (input.markdownAnchor !== undefined ||
      input.canvasRevealAnchor !== undefined ||
      (input.line !== undefined && input.line >= 1));
  const anchorRequestId = wantsPreviewReveal
    ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    : undefined;
  const lineOnlyReveal =
    input.preferPreview === true &&
    input.markdownAnchor === undefined &&
    input.canvasRevealAnchor === undefined &&
    input.line !== undefined &&
    input.line >= 1;
  return {
    ...(input.markdownAnchor === undefined
      ? {}
      : {
          markdownAnchor: input.markdownAnchor,
          markdownAnchorRequestId: anchorRequestId,
          markdownRevealLine: undefined,
          canvasRevealAnchor: undefined,
        }),
    ...(lineOnlyReveal
      ? {
          markdownAnchor: undefined,
          markdownAnchorRequestId: anchorRequestId,
          markdownRevealLine: input.line,
          canvasRevealAnchor: undefined,
        }
      : {}),
    ...(input.preferPreview === true && input.canvasRevealAnchor !== undefined
      ? {
          canvasRevealAnchor: input.canvasRevealAnchor,
          canvasRevealRequestId: anchorRequestId,
          markdownRevealLine: undefined,
        }
      : {}),
  };
}

function openFilesDiskPathResult(
  input: OpenFilesDiskPathInput
): OpenFilesDiskPathCommandResult {
  const pathParsed = nonEmptyFileRootRelativePathSchema.safeParse(input.path);
  if (!(pathParsed.success && input.root.length > 0)) {
    return { ok: false, reason: "invalid-path" };
  }

  if (!getPluginPanelRegistrations().has(FILES_FILE_PANEL_COMPONENT_ID)) {
    return { ok: false, reason: "files-unregistered" };
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
    const existingSource = parseFilesDiskSourceFromParams(panel.params);
    return (
      existingSource !== null && sameFilesDiskSource(existingSource, source)
    );
  });

  const existingParams = cloneParamsRecord(existing?.params);
  // Always refresh disk source on open so params match the request path even
  // when reusing an instance (identity key is path-scoped today).
  const params = {
    ...(existingParams ?? { pinned: true }),
    source,
    ...previewRevealParams(input),
  };
  const identityKey = `${FILES_FILE_PANEL_COMPONENT_ID}:disk:${stableFileIdentityHash(
    `${source.root}\u0000${source.path}`
  )}`;
  const reused = existing !== undefined;
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
    ...(existing
      ? {}
      : {
          ...(input.placement ? { placement: input.placement } : {}),
          ...(input.referencePanelId
            ? { referencePanelId: input.referencePanelId }
            : {}),
        }),
  });
  if (result.kind !== "opened") {
    return { ok: false, reason: "open-failed" };
  }
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
    ...(input.canvasRevealAnchor === undefined
      ? {}
      : { canvasRevealAnchor: input.canvasRevealAnchor }),
    ...(input.revealTree === false ? { revealTree: false } : {}),
  });
  return { ok: true, panelId: instanceId, reused };
}
