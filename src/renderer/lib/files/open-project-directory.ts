import { notifyFilesProjectDirectoryOpened } from "@plugins/api/files-project-directory-opened.ts";
import type { OpenProjectDirectoryResult } from "@plugins/api/renderer-facades.ts";
import { fileRootRelativePathSchema } from "@shared/contracts/file.ts";
import type { PanelContext, PanelSnapshot } from "@shared/contracts/panel.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import {
  groupForPanel,
  openPluginPanelInstance,
} from "../plugins/host/panel-instance-open.ts";
import { getPluginPanelRegistrations } from "../plugins/panel-registry.ts";
import { stableFileIdentityHash } from "./identity-hash.ts";

/** 与 files 插件 `FILES_FILE_PANEL_ID` / `open-disk-file-panel.ts` 对齐。 */
const FILES_FILE_PANEL_COMPONENT_ID = "pier.files.filePanel";

export interface OpenProjectDirectoryInput {
  context?: PanelContext;
  path?: string;
  root: string;
}

type WorkspaceDockviewApi = NonNullable<
  ReturnType<typeof useWorkspaceStore.getState>["api"]
>;
type DockviewPanelRef = WorkspaceDockviewApi["panels"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneParamsRecord(params: unknown): Record<string, unknown> {
  return isRecord(params) ? { ...params } : {};
}

function panelsFromListResult(listed: unknown): PanelSnapshot[] {
  if (Array.isArray(listed)) {
    return listed;
  }
  if (isRecord(listed) && "panels" in listed && Array.isArray(listed.panels)) {
    return listed.panels as PanelSnapshot[];
  }
  return [];
}

function projectNameFromRoot(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
}

function projectAnchorFromParams(params: unknown): string | null {
  if (!(isRecord(params) && "context" in params && isRecord(params.context))) {
    return null;
  }
  const context = params.context;
  const pick = (key: string): string | null => {
    const value = context[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  return (
    pick("projectRootPath") ??
    pick("worktreeRoot") ??
    pick("gitRoot") ??
    pick("cwd")
  );
}

function paramsHaveDocumentSource(params: unknown): boolean {
  if (!(isRecord(params) && "source" in params && isRecord(params.source))) {
    return false;
  }
  const kind = params.source.kind;
  return typeof kind === "string" && kind.length > 0;
}

export function createProjectFilesInstanceId(root: string): string {
  return `${FILES_FILE_PANEL_COMPONENT_ID}:project:${stableFileIdentityHash(root)}`;
}

function isProjectDirectoryIdentity(
  instanceId: string,
  params: unknown,
  root: string
): boolean {
  const canonical = createProjectFilesInstanceId(root);
  if (instanceId === canonical || instanceId.startsWith(`${canonical}:`)) {
    return true;
  }
  if (paramsHaveDocumentSource(params)) {
    return false;
  }
  return projectAnchorFromParams(params) === root;
}

function localFilesPanels(api: WorkspaceDockviewApi): DockviewPanelRef[] {
  return api.panels.filter(
    (panel) => panel.view.contentComponent === FILES_FILE_PANEL_COMPONENT_ID
  );
}

function findLocalProjectDirectory(
  panels: readonly DockviewPanelRef[],
  root: string
): DockviewPanelRef | undefined {
  const canonical = createProjectFilesInstanceId(root);
  return (
    panels.find((panel) => panel.id === canonical) ??
    panels.find((panel) =>
      isProjectDirectoryIdentity(panel.id, panel.params, root)
    )
  );
}

function findRemoteProjectDirectory(
  listed: readonly PanelSnapshot[],
  localIds: ReadonlySet<string>,
  root: string
): PanelSnapshot | undefined {
  const canonical = createProjectFilesInstanceId(root);
  const candidates = listed.filter(
    (panel) =>
      panel.component === FILES_FILE_PANEL_COMPONENT_ID &&
      typeof panel.windowId === "string" &&
      panel.windowId.length > 0 &&
      !localIds.has(panel.id)
  );
  return (
    candidates.find((panel) => panel.id === canonical) ??
    candidates.find((panel) =>
      isProjectDirectoryIdentity(panel.id, panel.params, root)
    )
  );
}

type RemoteFocusResult =
  | { ok: true; instanceId: string }
  | { ok: false; reason: "not-found" | "open-failed" };

async function focusRemoteDirectory(
  match: PanelSnapshot
): Promise<RemoteFocusResult> {
  const windowId = match.windowId;
  if (windowId === undefined) {
    return { ok: false, reason: "open-failed" };
  }
  try {
    const listed = panelsFromListResult(
      await window.pier.panels.list(windowId)
    );
    const stillThere = listed.find(
      (panel) =>
        panel.id === match.id &&
        (panel.component === undefined ||
          panel.component === FILES_FILE_PANEL_COMPONENT_ID)
    );
    if (!stillThere) {
      return { ok: false, reason: "not-found" };
    }
    await window.pier.panels.focus(match.id, { windowId });
    return { ok: true, instanceId: match.id };
  } catch {
    return { ok: false, reason: "open-failed" };
  }
}

function notifyOpened(input: {
  instanceId: string;
  path: string;
  root: string;
}): void {
  notifyFilesProjectDirectoryOpened({
    instanceId: input.instanceId,
    path: input.path,
    root: input.root,
  });
}

/**
 * Host-only open/focus of the Files project-directory tab (no document source).
 * Does not reveal — files plugin listens on the sibling bus.
 */
export async function openProjectDirectory(
  input: OpenProjectDirectoryInput
): Promise<OpenProjectDirectoryResult> {
  const root = input.root.trim();
  if (root.length === 0) {
    return { ok: false, reason: "no-anchor" };
  }
  const path = input.path ?? "";
  if (path.length > 0 && !fileRootRelativePathSchema.safeParse(path).success) {
    return { ok: false, reason: "invalid-path" };
  }
  if (!getPluginPanelRegistrations().has(FILES_FILE_PANEL_COMPONENT_ID)) {
    return { ok: false, reason: "files-unregistered" };
  }

  try {
    const api = useWorkspaceStore.getState().api;
    const local = api ? localFilesPanels(api) : [];
    const existing = findLocalProjectDirectory(local, root);
    const activeId = api?.activePanel?.id;
    if (existing && existing.id === activeId && path.length === 0) {
      return { ok: true, instanceId: existing.id, reused: true };
    }

    if (existing && api) {
      if (existing.id !== activeId) {
        const groupId = groupForPanel(api, existing.id)?.id;
        const result = openPluginPanelInstance({
          componentId: FILES_FILE_PANEL_COMPONENT_ID,
          ...(input.context ? { context: input.context } : {}),
          instanceId: existing.id,
          params: cloneParamsRecord(existing.params),
          title:
            typeof existing.title === "string" && existing.title.length > 0
              ? existing.title
              : projectNameFromRoot(root),
          ...(groupId ? { targetGroupId: groupId } : {}),
        });
        if (result.kind !== "opened") {
          return { ok: false, reason: "open-failed" };
        }
      }
      notifyOpened({ instanceId: existing.id, path, root });
      return { ok: true, instanceId: existing.id, reused: true };
    }

    const localIds = new Set(local.map((panel) => panel.id));
    const listed = panelsFromListResult(await window.pier.panels.list());
    const remote = findRemoteProjectDirectory(listed, localIds, root);
    if (remote) {
      const focused = await focusRemoteDirectory(remote);
      if (focused.ok) {
        return { ok: true, instanceId: focused.instanceId, reused: true };
      }
      if (focused.reason !== "not-found") {
        return { ok: false, reason: "open-failed" };
      }
    }

    const instanceId = createProjectFilesInstanceId(root);
    const opened = openPluginPanelInstance({
      componentId: FILES_FILE_PANEL_COMPONENT_ID,
      ...(input.context ? { context: input.context } : {}),
      instanceId,
      params: {},
      title: projectNameFromRoot(root),
    });
    if (opened.kind !== "opened") {
      return { ok: false, reason: "open-failed" };
    }
    notifyOpened({ instanceId, path, root });
    return { ok: true, instanceId, reused: false };
  } catch {
    return { ok: false, reason: "open-failed" };
  }
}
