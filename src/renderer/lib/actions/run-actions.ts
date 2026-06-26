import type {
  TerminalListSnapshot,
  TerminalOpenSessionSnapshot,
  TerminalRecentSessionSnapshot,
} from "@shared/contracts/terminal.ts";
import i18next from "i18next";
import { List, Play } from "lucide-react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import type {
  QuickPickItem,
  QuickPickItemBadge,
  QuickPickSection,
} from "@/lib/command-palette/types.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const PATH_SEPARATOR_RE = /[\\/]/;

function formatClosedAt(closedAt: string): string {
  const timestamp = Date.parse(closedAt);
  if (!Number.isFinite(timestamp)) {
    return closedAt;
  }
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) {
    return i18next.t("commandPalette.run.time.justNow");
  }
  if (diffMs < hour) {
    return i18next.t("commandPalette.run.time.minutesAgo", {
      count: Math.floor(diffMs / minute),
    });
  }
  if (diffMs < day) {
    return i18next.t("commandPalette.run.time.hoursAgo", {
      count: Math.floor(diffMs / hour),
    });
  }
  return i18next.t("commandPalette.run.time.daysAgo", {
    count: Math.floor(diffMs / day),
  });
}

function basenameOf(path: string | undefined): string | undefined {
  if (!path) {
    return;
  }
  return path.split(PATH_SEPARATOR_RE).filter(Boolean).at(-1);
}

function terminalLabel(session: {
  cwd?: string | undefined;
  panelId: string;
  title?: string | undefined;
}): string {
  return session.title ?? basenameOf(session.cwd) ?? session.panelId;
}

function terminalTabBadge(
  session: TerminalOpenSessionSnapshot
): QuickPickItemBadge[] {
  return [
    {
      label: i18next.t("commandPalette.run.badge.tab", {
        tab: session.tabIndex + 1,
        total: session.tabCount,
      }),
      variant: "outline",
    },
  ];
}

function sectionHeading(
  session: TerminalOpenSessionSnapshot,
  windowOrdinal: number
): string {
  const parts = [
    i18next.t("commandPalette.run.section.window", {
      window: windowOrdinal,
    }),
  ];
  if (session.windowFocused) {
    parts.push(i18next.t("commandPalette.run.section.currentWindow"));
  }
  parts.push(
    i18next.t("commandPalette.run.section.group", {
      group: session.groupIndex + 1,
    })
  );
  return parts.join(" · ");
}

function compareOpenSessions(
  a: TerminalOpenSessionSnapshot,
  b: TerminalOpenSessionSnapshot
): number {
  return (
    a.windowIndex - b.windowIndex ||
    a.groupIndex - b.groupIndex ||
    a.tabIndex - b.tabIndex ||
    a.windowId.localeCompare(b.windowId) ||
    a.panelId.localeCompare(b.panelId)
  );
}

function terminalCommandErrorMessage(result: {
  error?: string | undefined;
  ok: boolean;
}): string {
  return result.error ?? "terminal command failed";
}

function buildTerminalListSections(snapshot: TerminalListSnapshot): {
  recentByItemId: Map<string, TerminalRecentSessionSnapshot>;
  sections: QuickPickSection[];
  terminalByItemId: Map<string, TerminalOpenSessionSnapshot>;
} {
  const terminalByItemId = new Map<string, TerminalOpenSessionSnapshot>();
  const recentByItemId = new Map<string, TerminalRecentSessionSnapshot>();
  const windowOrdinalById = new Map<string, number>();
  const openSessions = [...snapshot.open].sort(compareOpenSessions);

  for (const session of openSessions) {
    if (!windowOrdinalById.has(session.windowId)) {
      windowOrdinalById.set(session.windowId, windowOrdinalById.size + 1);
    }
  }

  const sections: Array<{
    heading: string;
    id: string;
    items: QuickPickItem[];
  }> = [];
  const sectionById = new Map<
    string,
    { heading: string; id: string; items: QuickPickItem[] }
  >();
  for (const session of openSessions) {
    const itemId = `terminal:${session.windowId}:${session.panelId}`;
    terminalByItemId.set(itemId, session);
    const sectionId = `window:${session.windowId}:group:${session.groupIndex}`;
    let section = sectionById.get(sectionId);
    if (!section) {
      section = {
        heading: sectionHeading(
          session,
          windowOrdinalById.get(session.windowId) ?? 1
        ),
        id: sectionId,
        items: [],
      };
      sectionById.set(sectionId, section);
      sections.push(section);
    }
    const item: QuickPickItem = {
      badges: terminalTabBadge(session),
      checked: session.windowFocused === true && session.active === true,
      id: itemId,
      keywords: [
        session.panelId,
        session.windowId,
        session.recordId,
        session.title,
        session.cwd,
        section.heading,
      ].filter((value): value is string => typeof value === "string"),
      label: terminalLabel(session),
      ...(session.cwd ? { detail: session.cwd } : {}),
    };
    section.items = [...section.items, item];
  }

  if (snapshot.recentClosed.length > 0) {
    const recentItems = snapshot.recentClosed.map((session) => {
      const itemId = `recent:${session.recordId}:${session.id}`;
      recentByItemId.set(itemId, session);
      return {
        badges: [
          {
            label: i18next.t("commandPalette.run.badge.closed"),
            variant: "secondary" as const,
          },
        ],
        description: i18next.t("commandPalette.run.action.reopen"),
        detail: [session.cwd, formatClosedAt(session.closedAt)].join(" · "),
        id: itemId,
        keywords: [
          session.panelId,
          session.windowId,
          session.recordId,
          session.title,
          session.cwd,
          formatClosedAt(session.closedAt),
        ].filter((value): value is string => typeof value === "string"),
        label: terminalLabel(session),
      };
    });
    sections.push({
      heading: i18next.t("commandPalette.run.section.recentClosed"),
      id: "recent-closed",
      items: recentItems,
    });
  }

  if (snapshot.errors.length > 0) {
    sections.push({
      heading: i18next.t("commandPalette.run.section.errors"),
      id: "terminal-errors",
      items: snapshot.errors.map((error, index) => ({
        badges: [
          {
            label: i18next.t("commandPalette.run.badge.error"),
            variant: "destructive" as const,
          },
        ],
        detail: [error.windowId, error.recordId]
          .filter((value): value is string => typeof value === "string")
          .join(" · "),
        disabled: true,
        id: `terminal-error:${index}`,
        keywords: [error.windowId, error.recordId].filter(
          (value): value is string => typeof value === "string"
        ),
        label: error.message,
      })),
    });
  }

  return {
    recentByItemId,
    sections: sections satisfies QuickPickSection[],
    terminalByItemId,
  };
}

export function registerRunActions(): () => void {
  const disposers: Array<() => void> = [];

  disposers.push(
    actionRegistry.register({
      category: "Run",
      handler: () => {
        useCommandPaletteController.getState().openQuickPick({
          title: i18next.t("commandPalette.action.runTask"),
          placeholder: i18next.t("commandPalette.placeholder.runTask"),
          items: [
            {
              description: i18next.t("commandPalette.run.action.later"),
              detail: i18next.t("commandPalette.run.taskPlaceholderDetail"),
              disabled: true,
              id: "task-placeholder",
              label: i18next.t("commandPalette.run.taskPlaceholder"),
            },
          ],
          onAccept: () => undefined,
        });
      },
      id: "pier.run.task",
      metadata: {
        group: "1_run",
        iconComponent: Play,
        keywords: ["task", "run", "任务", "运行"],
        sortOrder: 0,
      },
      surfaces: ["command-palette"],
      title: () => i18next.t("commandPalette.action.runTask"),
    })
  );

  disposers.push(
    actionRegistry.register({
      category: "Run",
      enabled: () => useWorkspaceStore.getState().api != null,
      handler: async () => {
        if (!useWorkspaceStore.getState().api) {
          return;
        }
        const snapshot = await window.pier.terminal.listSessions();
        const { recentByItemId, sections, terminalByItemId } =
          buildTerminalListSections(snapshot);
        useCommandPaletteController.getState().openQuickPick({
          title: i18next.t("commandPalette.action.terminalList"),
          placeholder: i18next.t("commandPalette.placeholder.terminalList"),
          ...(sections.length > 0
            ? { sections }
            : {
                items: [
                  {
                    description: i18next.t("commandPalette.run.action.later"),
                    detail: i18next.t("commandPalette.run.noTerminalsDetail"),
                    disabled: true,
                    id: "terminal-empty",
                    label: i18next.t("commandPalette.run.noTerminals"),
                  },
                ],
              }),
          onAccept: async (item) => {
            const terminalSession = terminalByItemId.get(item.id);
            if (terminalSession) {
              const result = await window.pier.terminal.focusSession({
                panelId: terminalSession.panelId,
                windowId: terminalSession.windowId,
              });
              if (!result.ok) {
                throw new Error(terminalCommandErrorMessage(result));
              }
              return;
            }
            const recentSession = recentByItemId.get(item.id);
            if (recentSession) {
              const result = await window.pier.terminal.openSession({
                cwd: recentSession.cwd,
                ...(recentSession.windowAlive && recentSession.windowId
                  ? { windowId: recentSession.windowId }
                  : {}),
              });
              if (!result.ok) {
                throw new Error(terminalCommandErrorMessage(result));
              }
            }
          },
        });
      },
      id: "pier.run.terminalList",
      metadata: {
        group: "1_run",
        iconComponent: List,
        keywords: ["terminal", "list", "session", "终端", "列表"],
        sortOrder: 2,
      },
      surfaces: ["command-palette"],
      title: () => i18next.t("commandPalette.action.terminalList"),
    })
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
