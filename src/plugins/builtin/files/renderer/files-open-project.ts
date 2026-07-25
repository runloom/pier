import type {
  PluginPanelInstanceSnapshot,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { panelContextSchema } from "@shared/contracts/panel.ts";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import {
  ensureProjectFileTreeExpanded,
  projectNameFromRoot,
} from "./file-tree-preferences.ts";
import { parseFilesDocumentPanelSource } from "./files-document-types.ts";
import { projectAnchor } from "./files-project-anchor.ts";
import { stableFileIdentityHash } from "./files-stable-hash.ts";
import { revealFilesTreePath } from "./files-tree-registry.ts";

const REVEAL_DELAY_MS = 80;

export function createProjectFilesInstanceId(root: string): string {
  return `${FILES_FILE_PANEL_ID}:project:${stableFileIdentityHash(root)}`;
}

function contextFromParams(params: unknown): PanelContext | undefined {
  if (!params || typeof params !== "object" || !("context" in params)) {
    return;
  }
  const raw = (params as { context: unknown }).context;
  const parsed = panelContextSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Project-directory tabs are tree-only (no open document source). */
function isProjectDirectoryInstance(
  instance: PluginPanelInstanceSnapshot,
  anchor: string
): boolean {
  const projectInstanceId = createProjectFilesInstanceId(anchor);
  if (
    instance.id === projectInstanceId ||
    instance.id.startsWith(`${projectInstanceId}:`)
  ) {
    return true;
  }
  if (parseFilesDocumentPanelSource(instance.params) !== null) {
    return false;
  }
  return projectAnchor(contextFromParams(instance.params)) === anchor;
}

function findOpenProjectDirectory(
  instances: readonly PluginPanelInstanceSnapshot[],
  anchor: string
): PluginPanelInstanceSnapshot | undefined {
  const projectInstanceId = createProjectFilesInstanceId(anchor);
  return (
    instances.find((instance) => instance.id === projectInstanceId) ??
    instances.find((instance) => isProjectDirectoryInstance(instance, anchor))
  );
}

function scheduleProjectReveal(anchor: string): void {
  ensureProjectFileTreeExpanded(anchor);
  globalThis.setTimeout(() => {
    revealFilesTreePath({ path: "", root: anchor });
  }, REVEAL_DELAY_MS);
}

export async function openProjectFiles(
  pluginContext: RendererPluginContext,
  panelContext: PanelContext
): Promise<{ ok: true } | { ok: false; reason: "no-anchor" | "open-failed" }> {
  const anchor = projectAnchor(panelContext);
  if (!anchor) {
    return { ok: false, reason: "no-anchor" };
  }

  try {
    const instances = pluginContext.panels.listInstances(FILES_FILE_PANEL_ID);
    const existing = findOpenProjectDirectory(instances, anchor);
    const activeId =
      pluginContext.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
    // Already focused on this project's files panel — re-open / reveal would
    // flash the tab and tree without changing anything useful.
    if (existing && existing.id === activeId) {
      return { ok: true };
    }

    if (existing) {
      pluginContext.panels.openInstance({
        componentId: FILES_FILE_PANEL_ID,
        context: panelContext,
        instanceId: existing.id,
        params: existing.params ? { ...existing.params } : {},
        title: existing.title,
        ...(existing.groupId ? { targetGroupId: existing.groupId } : {}),
      });
      scheduleProjectReveal(anchor);
      return { ok: true };
    }

    // Local miss: focus any window that already has this project directory.
    const globalMatch = (
      await pluginContext.panels.listInstancesGlobal(FILES_FILE_PANEL_ID)
    ).find((instance) => isProjectDirectoryInstance(instance, anchor));
    if (globalMatch) {
      const remoteFocus = await pluginContext.panels.focusInstance({
        componentId: FILES_FILE_PANEL_ID,
        instanceId: globalMatch.id,
        windowId: globalMatch.windowId,
      });
      if (remoteFocus.kind === "focused") {
        // Tree reveal is owned by the focused window; skip local reveal.
        return { ok: true };
      }
      if (remoteFocus.kind === "error") {
        return { ok: false, reason: "open-failed" };
      }
      // not_found — fall through to create locally.
    }

    pluginContext.panels.openInstance({
      componentId: FILES_FILE_PANEL_ID,
      context: panelContext,
      instanceId: createProjectFilesInstanceId(anchor),
      params: {},
      title: projectNameFromRoot(anchor),
    });

    scheduleProjectReveal(anchor);
    return { ok: true };
  } catch {
    return { ok: false, reason: "open-failed" };
  }
}
