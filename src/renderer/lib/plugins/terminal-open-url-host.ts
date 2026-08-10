import {
  listTerminalOpenUrlHandlers,
  resetTerminalOpenUrlHandlersForTests as resetHandlers,
} from "@plugins/api/terminal-open-url-handlers.ts";
import type { TerminalOpenUrlEvent } from "@shared/contracts/terminal.ts";
import { shouldNeverSystemOpen } from "@shared/system-open-guard.ts";
import { resolveTerminalLocalPathTargets } from "@shared/terminal-local-path.ts";
import {
  diskTargetPartsForAbsolute,
  withTerminalOpenAnchor,
} from "@shared/terminal-open-disk-target.ts";
import i18next from "i18next";
import { toast } from "sonner";
import { openFilesDiskPath } from "@/lib/files/open-disk-file-panel.ts";
import { getTerminalPanelContext } from "./host/terminal-context.ts";

let hostInstalled = false;
let unsubscribe: (() => void) | null = null;

function toastUnresolved(
  reason: "relative-without-cwd" | "unsupported-scheme" | "invalid"
): void {
  if (reason === "relative-without-cwd") {
    toast.error(i18next.t("terminal.openPathRelativeWithoutCwd"));
    return;
  }
  if (reason === "unsupported-scheme") {
    toast.error(i18next.t("terminal.openPathUnsupportedScheme"));
    return;
  }
  toast.error(i18next.t("terminal.openPathInvalid"));
}

async function trySystemOpenAbsolute(absolutePath: string): Promise<boolean> {
  if (shouldNeverSystemOpen(absolutePath)) {
    console.info("[terminal-open-url-host] system open blocked", {
      path: absolutePath,
      blocked: "prefer-pier-editor",
    });
    return false;
  }
  const result = await window.pier.files.openPath({ path: absolutePath });
  return result.opened;
}

async function statRelative(input: {
  path: string;
  root: string;
}): Promise<{ exists: boolean; isDirectory: boolean } | null> {
  const statFn = window.pier?.files?.stat;
  if (typeof statFn !== "function") {
    return null;
  }
  try {
    const stat = await statFn(input);
    return { exists: stat.exists, isDirectory: stat.isDirectory };
  } catch {
    return null;
  }
}

/**
 * Host fallback when no plugin handler consumes the event (e.g. files not
 * activated yet). Prefer Pier Files panel; never shell-open source paths.
 *
 * Mirrors files-handler selection: multi-root candidates, existence probe,
 * anchor-aware disk root. Directories use OS open (Finder) — project tree
 * reveal requires the files open-url handler.
 */
async function openLocalPathViaHost(
  event: TerminalOpenUrlEvent
): Promise<void> {
  const panelContext = getTerminalPanelContext(event.panelId);
  const resolved = resolveTerminalLocalPathTargets(event.url, panelContext);

  if (resolved.kind === "remote") {
    return;
  }
  if (resolved.kind === "unresolved") {
    toastUnresolved(resolved.reason);
    return;
  }

  const line = event.line ?? resolved.line;
  const column = event.column ?? resolved.column;
  const existingFiles: string[] = [];
  let pierOpenFailed = false;

  for (const absolutePath of resolved.paths) {
    const parts = diskTargetPartsForAbsolute(absolutePath, panelContext);
    const { relativePath, root } = parts;
    const openContext = withTerminalOpenAnchor(panelContext, root);

    // Directory/root leaf: host cannot reveal a project tree.
    if (relativePath === "") {
      if (await trySystemOpenAbsolute(absolutePath)) {
        return;
      }
      continue;
    }

    const st = await statRelative({ path: relativePath, root });
    // No stat API: still attempt Pier open (dev harness / partial mock).
    if (st === null) {
      const opened = openFilesDiskPath({
        path: relativePath,
        root,
        ...(openContext ? { context: openContext } : {}),
        ...(line === undefined ? {} : { line }),
        ...(column === undefined ? {} : { column }),
      });
      if (opened) {
        return;
      }
      pierOpenFailed = true;
      existingFiles.push(absolutePath);
      continue;
    }

    if (!st.exists) {
      continue;
    }

    if (st.isDirectory) {
      if (await trySystemOpenAbsolute(absolutePath)) {
        return;
      }
      continue;
    }

    existingFiles.push(absolutePath);
    const opened = openFilesDiskPath({
      path: relativePath,
      root,
      ...(openContext ? { context: openContext } : {}),
      ...(line === undefined ? {} : { line }),
      ...(column === undefined ? {} : { column }),
    });
    if (opened) {
      return;
    }
    pierOpenFailed = true;
  }

  // Existing files that Files could not open → OS only when not source/text.
  if (pierOpenFailed || existingFiles.length > 0) {
    for (const absolutePath of existingFiles) {
      if (await trySystemOpenAbsolute(absolutePath)) {
        return;
      }
    }
  }

  toast.error(i18next.t("terminal.openPathFailed"));
}

async function dispatch(event: TerminalOpenUrlEvent): Promise<void> {
  for (const handler of listTerminalOpenUrlHandlers()) {
    if (await handler(event)) {
      return;
    }
  }
  await openLocalPathViaHost(event);
}

export function installTerminalOpenUrlHost(): () => void {
  if (hostInstalled) {
    return () => undefined;
  }
  const onOpenUrl = window.pier?.terminal?.onOpenUrl;
  if (typeof onOpenUrl !== "function") {
    // Unit harnesses often mock a partial `window.pier`; skip host install until
    // a full terminal API is present (real app always provides onOpenUrl).
    return () => undefined;
  }
  hostInstalled = true;
  unsubscribe = onOpenUrl((event) => {
    dispatch(event).catch((error: unknown) => {
      console.error("[terminal-open-url-host] dispatch failed:", error);
    });
  });
  return () => {
    unsubscribe?.();
    unsubscribe = null;
    hostInstalled = false;
    resetHandlers();
  };
}

/** @internal test helper */
export function resetTerminalOpenUrlHostForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  hostInstalled = false;
  resetHandlers();
}
