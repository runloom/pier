import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { addTerminalOpenUrlHandler } from "@plugins/api/terminal-open-url-handlers.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { TerminalOpenUrlEvent } from "@shared/contracts/terminal.ts";
import { FILES_FILE_PANEL_ID } from "../manifest.ts";
import { createFileFilePanelInstanceId } from "./file-panel-id.ts";
import { sourceTitle } from "./file-panel-source.ts";
import {
  parseFilesDocumentPanelSource,
  sameFilesDocumentPanelSource,
} from "./files-document-types.ts";
import { createFilesTranslate } from "./files-i18n.ts";
import { openProjectFiles } from "./files-open-project.ts";
import {
  longestCoveringAnchor,
  terminalOpenUrlAnchors,
} from "./files-terminal-open-url-anchors.ts";
import { resolveTerminalLocalPathTargets } from "./files-terminal-open-url-resolve.ts";
import { revealFilesTreePath } from "./files-tree-registry.ts";

type SystemOpenFallbackReason = "open-instance-failed" | "open-project-failed";

const inflight = new Set<string>();

function toRootRelative(anchor: string, absolutePath: string): string | null {
  const from = anchor.replace(/\\/g, "/").replace(/\/+$/, "");
  const to = absolutePath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (to === from) {
    return "";
  }
  const prefix = `${from}/`;
  if (!to.startsWith(prefix)) {
    return null;
  }
  return to.slice(prefix.length);
}

function splitAbsoluteDiskTarget(absolutePath: string): {
  path: string;
  root: string;
} {
  const normalized =
    absolutePath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    return { path: "", root: "/" };
  }
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return { path: normalized.slice(1), root: "/" };
  }
  return {
    path: normalized.slice(slash + 1),
    root: normalized.slice(0, slash),
  };
}

function withTerminalAnchor(
  context: PanelContext | null,
  anchor: string
): PanelContext | null {
  if (!context) {
    return null;
  }
  return {
    ...context,
    projectRootPath: anchor,
  };
}

async function openAbsoluteWithSystem(
  context: RendererPluginContext,
  absolutePath: string,
  reason: SystemOpenFallbackReason
): Promise<boolean> {
  console.info("[files-terminal-open-url] system open fallback", {
    path: absolutePath,
    reason,
  });
  const result = await context.files.openPath({ path: absolutePath });
  if (!result.opened) {
    const t = createFilesTranslate(context);
    context.notifications.error(
      t(
        "files.notifications.terminalOpenUrl.openFailed",
        "Unable to open path."
      )
    );
  }
  return true;
}

function openDiskFile(
  context: RendererPluginContext,
  panelContext: PanelContext | null,
  root: string,
  relativePath: string
): void {
  const source = {
    kind: "disk" as const,
    path: relativePath,
    root,
  };
  // Align with Cmd+P: activate an already-open same-source tab instead of
  // minting a fresh nonce instance id on every terminal path click.
  const existingInstance = context.panels
    .listInstances(FILES_FILE_PANEL_ID)
    .find((instance) =>
      sameFilesDocumentPanelSource(
        parseFilesDocumentPanelSource(instance.params),
        source
      )
    );
  const existingSource = parseFilesDocumentPanelSource(
    existingInstance?.params
  );
  const existingParams = existingInstance?.params
    ? { ...existingInstance.params }
    : null;
  const params = existingParams ?? {
    pinned: true,
    source,
  };

  context.panels.openInstance({
    componentId: FILES_FILE_PANEL_ID,
    ...(existingInstance || !panelContext ? {} : { context: panelContext }),
    dropUnpinnedInstances: false,
    instanceId: existingInstance?.id ?? createFileFilePanelInstanceId(source),
    params,
    title: sourceTitle(existingSource ?? source),
  });
}

interface DiskTargetParts {
  absolutePath: string;
  relativePath: string;
  root: string;
}

function diskTargetPartsForAbsolute(
  absolutePath: string,
  panelContext: PanelContext | null
): DiskTargetParts {
  const anchors = terminalOpenUrlAnchors(panelContext);
  const anchor = longestCoveringAnchor(absolutePath, anchors);
  if (anchor) {
    const relativePath = toRootRelative(anchor, absolutePath);
    if (relativePath !== null) {
      return { absolutePath, relativePath, root: anchor };
    }
  }
  const fallback = splitAbsoluteDiskTarget(absolutePath);
  return {
    absolutePath,
    relativePath: fallback.path,
    root: fallback.root,
  };
}

/**
 * Open a disk path in Pier Files.
 *
 * Files always get a Files panel tab. Binary / too-large / unsupported
 * encodings are not routed to the OS default app — the panel loads the
 * document and shows its built-in unsupported/read-only fallback UI.
 * System open remains only when Files cannot open a project tree or mint
 * a panel instance at all.
 */
async function openDiskTarget(
  context: RendererPluginContext,
  panelContext: PanelContext | null,
  parts: DiskTargetParts
): Promise<"opened" | "missing" | "failed"> {
  const { absolutePath, relativePath, root } = parts;
  const openContext = withTerminalAnchor(panelContext, root);

  if (relativePath === "") {
    if (!openContext) {
      return "failed";
    }
    const opened = await openProjectFiles(context, openContext);
    if (!opened.ok) {
      await openAbsoluteWithSystem(
        context,
        absolutePath,
        "open-project-failed"
      );
      return "opened";
    }
    globalThis.setTimeout(() => {
      revealFilesTreePath({ path: "", root });
    }, 80);
    return "opened";
  }

  const stat = await context.files.stat({
    path: relativePath,
    root,
  });

  if (!stat.exists) {
    return "missing";
  }

  if (stat.isDirectory) {
    if (!openContext) {
      return "failed";
    }
    const opened = await openProjectFiles(context, openContext);
    if (!opened.ok) {
      await openAbsoluteWithSystem(
        context,
        absolutePath,
        "open-project-failed"
      );
      return "opened";
    }
    globalThis.setTimeout(() => {
      revealFilesTreePath({
        path: relativePath,
        root,
      });
    }, 80);
    return "opened";
  }

  try {
    openDiskFile(context, openContext, root, relativePath);
    return "opened";
  } catch {
    await openAbsoluteWithSystem(context, absolutePath, "open-instance-failed");
    return "opened";
  }
}

function reportUnresolved(
  context: RendererPluginContext,
  reason: "relative-without-cwd" | "unsupported-scheme" | "invalid"
): void {
  const t = createFilesTranslate(context);
  if (reason === "relative-without-cwd") {
    context.notifications.error(
      t(
        "files.notifications.terminalOpenUrl.relativeWithoutCwd",
        "This terminal has no working directory, so the relative path cannot be opened."
      )
    );
    return;
  }
  if (reason === "unsupported-scheme") {
    context.notifications.error(
      t(
        "files.notifications.terminalOpenUrl.unsupportedScheme",
        "Cannot open this link in Pier."
      )
    );
    return;
  }
  context.notifications.error(
    t("files.notifications.terminalOpenUrl.invalid", "Cannot open this path.")
  );
}

export async function handleFilesTerminalOpenUrl(
  context: RendererPluginContext,
  event: TerminalOpenUrlEvent
): Promise<boolean> {
  const panelContext = context.terminal.getPanelContext(event.panelId);
  const resolved = resolveTerminalLocalPathTargets(event.url, panelContext);

  if (resolved.kind === "remote") {
    return false;
  }

  if (resolved.kind === "unresolved") {
    reportUnresolved(context, resolved.reason);
    return true;
  }

  // Prefer the first candidate that already exists on disk so agent-relative
  // paths can fall back from cwd to worktree / project / git roots.
  for (const absolutePath of resolved.paths) {
    if (inflight.has(absolutePath)) {
      return true;
    }
    inflight.add(absolutePath);
    try {
      const parts = diskTargetPartsForAbsolute(absolutePath, panelContext);
      const result = await openDiskTarget(context, panelContext, parts);
      if (result === "opened") {
        return true;
      }
      // missing → try next root; failed → still try next when multi-root.
      if (result === "failed" && resolved.paths.length === 1) {
        break;
      }
    } finally {
      inflight.delete(absolutePath);
    }
  }

  reportUnresolved(context, "invalid");
  return true;
}

export function registerFilesTerminalOpenUrlHandler(
  context: RendererPluginContext
): () => void {
  return addTerminalOpenUrlHandler((event) =>
    handleFilesTerminalOpenUrl(context, event)
  );
}
