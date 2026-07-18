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
import { parseTerminalOpenUrl } from "./files-terminal-open-url-resolve.ts";
import { revealFilesTreePath } from "./files-tree-registry.ts";

type SystemOpenFallbackReason =
  | "binary-or-unsupported"
  | "missing-panel-context"
  | "missing-path"
  | "open-instance-failed"
  | "open-project-failed"
  | "outside-anchor";

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

function withTerminalAnchor(
  context: PanelContext,
  anchor: string
): PanelContext {
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
  panelContext: PanelContext,
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
    ...(existingInstance ? {} : { context: panelContext }),
    dropUnpinnedInstances: false,
    instanceId: existingInstance?.id ?? createFileFilePanelInstanceId(source),
    params,
    title: sourceTitle(existingSource ?? source),
  });
}

export async function handleFilesTerminalOpenUrl(
  context: RendererPluginContext,
  event: TerminalOpenUrlEvent
): Promise<boolean> {
  const panelContext = context.terminal.getPanelContext(event.panelId);
  const cwd = panelContext?.cwd ?? null;
  const parsed = parseTerminalOpenUrl(event.url, cwd);

  if (parsed.kind === "remote") {
    return false;
  }

  const t = createFilesTranslate(context);
  if (parsed.kind === "unresolved") {
    if (parsed.reason === "relative-without-cwd") {
      context.notifications.error(
        t(
          "files.notifications.terminalOpenUrl.relativeWithoutCwd",
          "This terminal has no working directory, so the relative path cannot be opened."
        )
      );
    } else {
      context.notifications.error(
        t(
          "files.notifications.terminalOpenUrl.invalid",
          "Cannot open this path."
        )
      );
    }
    return true;
  }

  const absolutePath = parsed.path;
  if (inflight.has(absolutePath)) {
    return true;
  }
  inflight.add(absolutePath);
  try {
    if (!panelContext) {
      return await openAbsoluteWithSystem(
        context,
        absolutePath,
        "missing-panel-context"
      );
    }

    const anchors = terminalOpenUrlAnchors(panelContext);
    const anchor = longestCoveringAnchor(absolutePath, anchors);
    if (!anchor) {
      return await openAbsoluteWithSystem(
        context,
        absolutePath,
        "outside-anchor"
      );
    }

    const relativePath = toRootRelative(anchor, absolutePath);
    if (relativePath === null) {
      return await openAbsoluteWithSystem(
        context,
        absolutePath,
        "outside-anchor"
      );
    }

    const openContext = withTerminalAnchor(panelContext, anchor);

    if (relativePath === "") {
      const opened = openProjectFiles(context, openContext);
      if (!opened.ok) {
        return await openAbsoluteWithSystem(
          context,
          absolutePath,
          "open-project-failed"
        );
      }
      globalThis.setTimeout(() => {
        revealFilesTreePath({ path: "", root: anchor });
      }, 80);
      return true;
    }

    const stat = await context.files.stat({
      path: relativePath,
      root: anchor,
    });

    if (!stat.exists) {
      return await openAbsoluteWithSystem(
        context,
        absolutePath,
        "missing-path"
      );
    }

    if (stat.isDirectory) {
      const opened = openProjectFiles(context, openContext);
      if (!opened.ok) {
        return await openAbsoluteWithSystem(
          context,
          absolutePath,
          "open-project-failed"
        );
      }
      globalThis.setTimeout(() => {
        revealFilesTreePath({
          path: relativePath,
          root: anchor,
        });
      }, 80);
      return true;
    }

    const document = await context.files.readDocument({
      path: relativePath,
      root: anchor,
    });
    if (
      document.kind === "binary" ||
      document.kind === "too-large" ||
      document.kind === "unsupported-encoding" ||
      document.kind === "unsupported-file"
    ) {
      return await openAbsoluteWithSystem(
        context,
        absolutePath,
        "binary-or-unsupported"
      );
    }

    try {
      openDiskFile(context, openContext, anchor, relativePath);
      return true;
    } catch {
      return await openAbsoluteWithSystem(
        context,
        absolutePath,
        "open-instance-failed"
      );
    }
  } finally {
    inflight.delete(absolutePath);
  }
}

export function registerFilesTerminalOpenUrlHandler(
  context: RendererPluginContext
): () => void {
  return addTerminalOpenUrlHandler((event) =>
    handleFilesTerminalOpenUrl(context, event)
  );
}
