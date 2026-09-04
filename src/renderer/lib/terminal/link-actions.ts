import { shouldNeverSystemOpen } from "@shared/system-open-guard.ts";
import { resolveTerminalLocalPathTargets } from "@shared/terminal-local-path.ts";
import i18next from "i18next";
import { toast } from "sonner";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { activeTerminalPanelId } from "@/lib/actions/renderer-action-runtime.ts";
import type { ActionInvocation } from "@/lib/actions/types.ts";
import {
  openAbsolutePath,
  revealAbsolutePath,
} from "@/lib/files/shell-path-actions.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

export const TERMINAL_OPEN_LINK_COMMAND_ID = "pier.terminal.openLink";
export const TERMINAL_COPY_LINK_COMMAND_ID = "pier.terminal.copyLink";
export const TERMINAL_REVEAL_LINK_COMMAND_ID = "pier.terminal.revealLink";
export const TERMINAL_OPEN_LINK_SYSTEM_COMMAND_ID =
  "pier.terminal.openWithSystemApp";

function resolveTerminalPanelId(invocation?: ActionInvocation): string | null {
  return invocation?.sourcePanelId ?? activeTerminalPanelId();
}

function linkUrlFromInvocation(invocation?: ActionInvocation): string | null {
  const raw = invocation?.metadata?.linkUrl;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function terminalLinkKind(
  invocation?: ActionInvocation
): "file" | "relative" | "remote" | null {
  const url = linkUrlFromInvocation(invocation);
  if (!url) {
    return null;
  }
  const resolved = resolveTerminalLocalPathTargets(
    url,
    invocation?.sourcePanelContext
  );
  if (resolved.kind === "remote") {
    return "remote";
  }
  if (resolved.kind === "local-paths") {
    return "file";
  }
  if (
    resolved.kind === "unresolved" &&
    resolved.reason === "relative-without-cwd"
  ) {
    return "relative";
  }
  return null;
}

function absoluteLinkPaths(invocation?: ActionInvocation): string[] {
  const url = linkUrlFromInvocation(invocation);
  if (!url) {
    return [];
  }
  const resolved = resolveTerminalLocalPathTargets(
    url,
    invocation?.sourcePanelContext
  );
  if (resolved.kind !== "local-paths") {
    return [];
  }
  return [...resolved.paths];
}

function copyTextForLink(invocation?: ActionInvocation): string | null {
  const url = linkUrlFromInvocation(invocation);
  if (!url) {
    return null;
  }
  const paths = absoluteLinkPaths(invocation);
  if (paths[0]) {
    return paths[0];
  }
  return url;
}

async function writeClipboardText(text: string): Promise<void> {
  if (window.pier?.clipboard?.writeText) {
    await window.pier.clipboard.writeText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

export const TERMINAL_LINK_ACTION_CONTRIBUTIONS: readonly ActionContribution[] =
  [
    {
      categoryKey: "terminal",
      group: "0_0_link",
      handler: async (invocation) => {
        const panelId = resolveTerminalPanelId(invocation);
        const url = linkUrlFromInvocation(invocation);
        if (!(panelId && url)) {
          return;
        }
        try {
          await window.pier.terminal.openUrl(panelId, url);
        } catch (error) {
          await showAppAlert({
            body: error instanceof Error ? error.message : String(error),
            title: i18next.t("contextMenu.action.terminalOperationFailed"),
          });
        }
      },
      id: TERMINAL_OPEN_LINK_COMMAND_ID,
      menuHidden: (invocation) => {
        const kind = terminalLinkKind(invocation);
        return kind == null || kind === "relative";
      },
      sortOrder: 0,
      surfaces: ["terminal/content"],
      title: (invocation) =>
        i18next.t(
          terminalLinkKind(invocation) === "remote"
            ? "contextMenu.action.openLink"
            : "contextMenu.action.openInPier"
        ),
      titleKey: "contextMenu.action.openInPier",
      when: "terminal.hasActivePanel",
    },
    {
      categoryKey: "terminal",
      group: "0_0_link",
      handler: async (invocation) => {
        const text = copyTextForLink(invocation);
        if (!text) {
          return;
        }
        try {
          await writeClipboardText(text);
          toast.success(i18next.t("contextMenu.action.pathCopied"));
        } catch (error) {
          await showAppAlert({
            body: error instanceof Error ? error.message : String(error),
            title: i18next.t("contextMenu.action.clipboardFailed"),
          });
        }
      },
      id: TERMINAL_COPY_LINK_COMMAND_ID,
      menuHidden: (invocation) => terminalLinkKind(invocation) == null,
      sortOrder: 1,
      surfaces: ["terminal/content"],
      title: (invocation) =>
        i18next.t(
          terminalLinkKind(invocation) === "remote"
            ? "contextMenu.action.copyLink"
            : "contextMenu.action.copyPath"
        ),
      titleKey: "contextMenu.action.copyPath",
      when: "terminal.hasActivePanel",
    },
    {
      categoryKey: "terminal",
      group: "0_0_link",
      handler: async (invocation) => {
        const path = absoluteLinkPaths(invocation)[0];
        if (!path) {
          return;
        }
        const result = await revealAbsolutePath(path);
        if (result.ok) {
          return;
        }
        await showAppAlert({
          body: result.reason,
          title: i18next.t("contextMenu.action.revealFailed"),
        });
      },
      id: TERMINAL_REVEAL_LINK_COMMAND_ID,
      menuHidden: (invocation) => absoluteLinkPaths(invocation).length === 0,
      sortOrder: 2,
      surfaces: ["terminal/content"],
      titleKey: "contextMenu.action.revealInFinder",
      when: "terminal.hasActivePanel",
    },
    {
      categoryKey: "terminal",
      group: "0_0_link",
      handler: async (invocation) => {
        const path = absoluteLinkPaths(invocation)[0];
        if (!path || shouldNeverSystemOpen(path)) {
          return;
        }
        const result = await openAbsolutePath(path);
        if (result.ok) {
          return;
        }
        await showAppAlert({
          body: result.reason,
          title: i18next.t("contextMenu.action.openWithSystemFailed"),
        });
      },
      id: TERMINAL_OPEN_LINK_SYSTEM_COMMAND_ID,
      menuHidden: (invocation) => {
        const path = absoluteLinkPaths(invocation)[0];
        return path == null || shouldNeverSystemOpen(path);
      },
      sortOrder: 3,
      surfaces: ["terminal/content"],
      titleKey: "contextMenu.action.openWithSystemApp",
      when: "terminal.hasActivePanel",
    },
  ];
