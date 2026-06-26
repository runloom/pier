import i18next from "i18next";
import { List, Play } from "lucide-react";
import { panelKindOf } from "@/components/workspace/panel-registry.ts";
import type { WorkspacePanelSnapshot } from "@/components/workspace/workspace-panel-snapshots.ts";
import { buildWorkspacePanelSnapshots } from "@/components/workspace/workspace-panel-snapshots.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import type {
  QuickPickItem,
  QuickPickItemBadge,
  QuickPickSection,
} from "@/lib/command-palette/types.ts";
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const PATH_SEPARATOR_RE = /[\\/]/;

function basenameOf(path: string | undefined): string | undefined {
  if (!path) {
    return;
  }
  return path.split(PATH_SEPARATOR_RE).filter(Boolean).at(-1);
}

function terminalLabel(panel: WorkspacePanelSnapshot): string {
  return panel.display?.short ?? basenameOf(panel.context?.cwd) ?? panel.id;
}

function terminalTabBadge(panel: WorkspacePanelSnapshot): QuickPickItemBadge[] {
  return [
    {
      label: i18next.t("commandPalette.run.badge.tab", {
        tab: panel.tabIndex + 1,
        total: panel.tabCount,
      }),
      variant: "outline",
    },
  ];
}

function sectionHeading(panel: WorkspacePanelSnapshot): string {
  return [
    i18next.t("commandPalette.run.section.window", { window: 1 }),
    i18next.t("commandPalette.run.section.currentWindow"),
    i18next.t("commandPalette.run.section.group", {
      group: panel.groupIndex + 1,
    }),
  ].join(" · ");
}

function comparePanels(
  a: WorkspacePanelSnapshot,
  b: WorkspacePanelSnapshot
): number {
  return (
    a.groupIndex - b.groupIndex ||
    a.tabIndex - b.tabIndex ||
    a.id.localeCompare(b.id)
  );
}

function buildTerminalPanelSections(openPanels: WorkspacePanelSnapshot[]): {
  panelsByItemId: Map<string, WorkspacePanelSnapshot>;
  sections: QuickPickSection[];
} {
  const panelsByItemId = new Map<string, WorkspacePanelSnapshot>();
  const sections: Array<{
    heading: string;
    id: string;
    items: QuickPickItem[];
  }> = [];
  const sectionById = new Map<
    string,
    { heading: string; id: string; items: QuickPickItem[] }
  >();

  for (const panel of [...openPanels].sort(comparePanels)) {
    const itemId = `panel:${panel.id}`;
    panelsByItemId.set(itemId, panel);
    const sectionId = `group:${panel.groupIndex}`;
    let section = sectionById.get(sectionId);
    if (!section) {
      section = {
        heading: sectionHeading(panel),
        id: sectionId,
        items: [],
      };
      sectionById.set(sectionId, section);
      sections.push(section);
    }
    const item: QuickPickItem = {
      badges: terminalTabBadge(panel),
      checked: panel.active === true,
      id: itemId,
      keywords: [
        panel.id,
        panel.context?.cwd,
        panel.context?.projectRoot,
        panel.context?.gitRoot,
        panel.context?.branch,
        section.heading,
      ].filter((value): value is string => typeof value === "string"),
      label: terminalLabel(panel),
      ...(panel.context?.cwd ? { detail: panel.context.cwd } : {}),
    };
    section.items = [...section.items, item];
  }

  return {
    panelsByItemId,
    sections: sections satisfies QuickPickSection[],
  };
}

function currentTerminalPanels(): WorkspacePanelSnapshot[] {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return [];
  }
  return buildWorkspacePanelSnapshots(
    api,
    usePanelDescriptorStore.getState().descriptors
  ).filter((panel) => panel.kind === "terminal");
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
      handler: () => {
        const api = useWorkspaceStore.getState().api;
        if (!api) {
          return;
        }
        const { panelsByItemId, sections } = buildTerminalPanelSections(
          currentTerminalPanels()
        );
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
          onAccept: (item) => {
            const panel = panelsByItemId.get(item.id);
            if (!panel) {
              return;
            }
            const result = activateWorkspacePanel(api, panel.id, {
              expectedKind: "terminal",
              kindOfComponent: panelKindOf,
              reveal: "always",
            });
            if (!result.ok) {
              throw new Error(result.message);
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
