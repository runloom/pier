import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { addTerminalOpenUrlHandler } from "@plugins/api/terminal-open-url-handlers.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { TerminalOpenUrlEvent } from "@shared/contracts/terminal.ts";
import { shouldNeverSystemOpen } from "@shared/system-open-guard.ts";
import {
  diskTargetPartsForAbsolute,
  type TerminalDiskTargetParts,
  withTerminalOpenAnchor,
} from "@shared/terminal-open-disk-target.ts";
import { FILES_FILE_PANEL_ID } from "../../manifest.ts";
import {
  parseFilesDocumentPanelSource,
  sameFilesDocumentPanelSource,
} from "../document/types.ts";
import type { FileEditorController } from "../editor/controller.ts";
import { createFileEditorSessionId } from "../editor/session-id.ts";
import { createFilesTranslate } from "../i18n.ts";
import { createFileFilePanelInstanceId } from "../panel/id.ts";
import { sourceTitle } from "../panel/source.ts";
import { openProjectFiles } from "../project/open-project.ts";
import { revealFilesTreePath } from "../tree/registry.ts";
import { resolveTerminalLocalPathTargets } from "./resolve.ts";

type SystemOpenFallbackReason = "open-instance-failed" | "open-project-failed";

type DiskOpenResult = "failed" | "missing" | "opened";

const inflight = new Map<string, Promise<void>>();

async function openAbsoluteWithSystem(
  context: RendererPluginContext,
  absolutePath: string,
  reason: SystemOpenFallbackReason
): Promise<boolean> {
  // Source/text paths (esp. `.ts` on macOS → MPEG-TS video apps) must never
  // fall through to the OS default opener from terminal clicks.
  if (shouldNeverSystemOpen(absolutePath)) {
    console.info("[files-terminal-open-url] system open blocked", {
      path: absolutePath,
      reason,
      blocked: "prefer-pier-editor",
    });
    const t = createFilesTranslate(context);
    context.notifications.error(
      t(
        "files.notifications.terminalOpenUrl.openFailed",
        "Unable to open path."
      )
    );
    return true;
  }
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

async function queueDiskOpen(
  absolutePath: string,
  open: () => Promise<DiskOpenResult>
): Promise<DiskOpenResult> {
  const previous = inflight.get(absolutePath) ?? Promise.resolve();
  const attempt = previous.then(open);
  const tail = attempt.then(
    () => undefined,
    () => undefined
  );
  inflight.set(absolutePath, tail);
  try {
    return await attempt;
  } finally {
    if (inflight.get(absolutePath) === tail) {
      inflight.delete(absolutePath);
    }
  }
}

function scheduleGoToLine(input: {
  column?: number | undefined;
  controller: FileEditorController | null | undefined;
  documentId: string;
  editorSessionId: string;
  line: number;
}): void {
  input.controller?.goToLine(
    input.editorSessionId,
    input.documentId,
    input.line,
    input.column
  );
}

function openDiskFile(input: {
  column?: number | undefined;
  context: RendererPluginContext;
  controller?: FileEditorController | null | undefined;
  line?: number | undefined;
  panelContext: PanelContext | null;
  relativePath: string;
  root: string;
}): void {
  const source = {
    kind: "disk" as const,
    path: input.relativePath,
    root: input.root,
  };
  // Align with Cmd+P: activate an already-open same-source tab instead of
  // minting a fresh nonce instance id on every terminal path click.
  const existingInstance = input.context.panels
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
  const instanceId =
    existingInstance?.id ?? createFileFilePanelInstanceId(source);
  const params = existingInstance?.params
    ? { ...existingInstance.params }
    : {
        pinned: true,
        source,
      };

  input.context.panels.openInstance({
    componentId: FILES_FILE_PANEL_ID,
    // Always refresh when the caller has a path anchor — reusing a tab that was
    // opened without context used to leave projectRootPath/cwd permanently empty.
    ...(input.panelContext ? { context: input.panelContext } : {}),
    dropUnpinnedInstances: false,
    instanceId,
    params,
    title: sourceTitle(existingSource ?? source),
  });

  if (input.line !== undefined && input.controller) {
    input.controller.showSourceMode(instanceId);
    scheduleGoToLine({
      ...(input.column === undefined ? {} : { column: input.column }),
      controller: input.controller,
      documentId: input.controller.documentId(source),
      editorSessionId: createFileEditorSessionId(instanceId),
      line: input.line,
    });
  }
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
async function openDiskTarget(input: {
  column?: number | undefined;
  context: RendererPluginContext;
  controller?: FileEditorController | null | undefined;
  line?: number | undefined;
  panelContext: PanelContext | null;
  parts: TerminalDiskTargetParts;
}): Promise<DiskOpenResult> {
  const { absolutePath, relativePath, root } = input.parts;
  const openContext = withTerminalOpenAnchor(input.panelContext, root);

  if (relativePath === "") {
    if (!openContext) {
      return "failed";
    }
    const opened = await openProjectFiles(input.context, openContext);
    if (!opened.ok) {
      await openAbsoluteWithSystem(
        input.context,
        absolutePath,
        "open-project-failed"
      );
      return "opened";
    }
    globalThis.setTimeout(() => {
      revealFilesTreePath({
        options: { intent: "root" },
        path: "",
        root,
      });
    }, 80);
    return "opened";
  }

  const stat = await input.context.files.stat({
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
    const opened = await openProjectFiles(input.context, openContext);
    if (!opened.ok) {
      await openAbsoluteWithSystem(
        input.context,
        absolutePath,
        "open-project-failed"
      );
      return "opened";
    }
    globalThis.setTimeout(() => {
      revealFilesTreePath({
        options: { intent: "explicit" },
        path: relativePath,
        root,
      });
    }, 80);
    return "opened";
  }

  try {
    openDiskFile({
      ...(input.column === undefined ? {} : { column: input.column }),
      context: input.context,
      controller: input.controller,
      ...(input.line === undefined ? {} : { line: input.line }),
      panelContext: openContext,
      relativePath,
      root,
    });
    return "opened";
  } catch {
    await openAbsoluteWithSystem(
      input.context,
      absolutePath,
      "open-instance-failed"
    );
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
  event: TerminalOpenUrlEvent,
  controller?: FileEditorController | null
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

  const line = event.line ?? resolved.line;
  const column = event.column ?? resolved.column;

  // Prefer the first candidate that already exists on disk so agent-relative
  // paths can fall back from cwd to worktree / project / git roots.
  for (const absolutePath of resolved.paths) {
    const parts = diskTargetPartsForAbsolute(absolutePath, panelContext);
    const result = await queueDiskOpen(
      absolutePath,
      async () =>
        await openDiskTarget({
          ...(column === undefined ? {} : { column }),
          context,
          controller,
          ...(line === undefined ? {} : { line }),
          panelContext,
          parts,
        })
    );
    if (result === "opened") {
      return true;
    }
    // missing → try next root; failed → still try next when multi-root.
    if (result === "failed" && resolved.paths.length === 1) {
      break;
    }
  }

  reportUnresolved(context, "invalid");
  return true;
}

export function registerFilesTerminalOpenUrlHandler(
  context: RendererPluginContext,
  controller?: FileEditorController | null
): () => void {
  return addTerminalOpenUrlHandler((event) =>
    handleFilesTerminalOpenUrl(context, event, controller)
  );
}
