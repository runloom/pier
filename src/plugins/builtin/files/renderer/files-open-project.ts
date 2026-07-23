import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { panelContextSchema } from "@shared/contracts/panel.ts";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import {
  ensureProjectFileTreeExpanded,
  projectNameFromRoot,
} from "./file-tree-preferences.ts";
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

export function openProjectFiles(
  pluginContext: RendererPluginContext,
  panelContext: PanelContext
): { ok: true } | { ok: false; reason: "no-anchor" | "open-failed" } {
  const anchor = projectAnchor(panelContext);
  if (!anchor) {
    return { ok: false, reason: "no-anchor" };
  }

  try {
    const instances = pluginContext.panels.listInstances(FILES_FILE_PANEL_ID);
    const existing = instances.find(
      (instance) => projectAnchor(contextFromParams(instance.params)) === anchor
    );
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
    } else {
      pluginContext.panels.openInstance({
        componentId: FILES_FILE_PANEL_ID,
        context: panelContext,
        instanceId: createProjectFilesInstanceId(anchor),
        params: {},
        title: projectNameFromRoot(anchor),
      });
    }

    ensureProjectFileTreeExpanded(anchor);
    globalThis.setTimeout(() => {
      revealFilesTreePath({ path: "", root: anchor });
    }, REVEAL_DELAY_MS);

    return { ok: true };
  } catch {
    return { ok: false, reason: "open-failed" };
  }
}
