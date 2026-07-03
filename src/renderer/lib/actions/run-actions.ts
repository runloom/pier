import type {
  TaskCandidate,
  TaskInputRequest,
  TaskListResult,
  TaskSource,
  TaskSpawnResult,
} from "@shared/contracts/tasks.ts";
import i18next from "i18next";
import { List, Play, RotateCcw, SquareTerminal } from "lucide-react";
import { panelKindOf } from "@/components/workspace/panel-registry.ts";
import type { WorkspacePanelSnapshot } from "@/components/workspace/workspace-panel-snapshots.ts";
import { buildWorkspacePanelSnapshots } from "@/components/workspace/workspace-panel-snapshots.ts";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import {
  activeTaskPanelMetadata,
  rendererActionContributionRuntime,
} from "@/lib/actions/renderer-action-runtime.ts";
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

function terminalLabel(panel: WorkspacePanelSnapshot): string {
  return (
    panel.display?.short ??
    panel.context?.cwd?.split(PATH_SEPARATOR_RE).filter(Boolean).at(-1) ??
    panel.id
  );
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
  return i18next.t("commandPalette.run.section.group", {
    group: panel.groupIndex + 1,
  });
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
      icon: SquareTerminal,
      id: itemId,
      searchTerms: [
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

function activeProjectRoot(): string | null {
  const api = useWorkspaceStore.getState().api;
  const activePanelId = api?.activePanel?.id;
  if (!activePanelId) {
    return null;
  }
  const descriptor =
    usePanelDescriptorStore.getState().descriptors[activePanelId];
  return descriptor?.context?.projectRoot ?? descriptor?.context?.cwd ?? null;
}

function taskSourceLabel(source: TaskSource): string {
  switch (source) {
    case "cargo":
      return i18next.t("commandPalette.run.taskTab.source.cargo");
    case "composer":
      return i18next.t("commandPalette.run.taskTab.source.composer");
    case "deno":
      return i18next.t("commandPalette.run.taskTab.source.deno");
    case "history":
      return i18next.t("commandPalette.run.taskTab.source.history");
    case "just":
      return i18next.t("commandPalette.run.taskTab.source.just");
    case "make":
      return i18next.t("commandPalette.run.taskTab.source.make");
    case "mise":
      return i18next.t("commandPalette.run.taskTab.source.mise");
    case "package-script":
      return i18next.t("commandPalette.run.taskTab.source.packageScript");
    case "pyproject":
      return i18next.t("commandPalette.run.taskTab.source.pyproject");
    case "taskfile":
      return i18next.t("commandPalette.run.taskTab.source.taskfile");
    case "vscode":
      return i18next.t("commandPalette.run.taskTab.source.vscode");
    case "zed":
      return i18next.t("commandPalette.run.taskTab.source.zed");
    default:
      return source;
  }
}

function commandDetail(task: TaskCandidate): string {
  if (task.commandSpec.kind === "process") {
    return [task.commandSpec.command, ...task.commandSpec.args].join(" ");
  }
  return task.commandSpec.command;
}

function taskItem(task: TaskCandidate): QuickPickItem {
  const description = task.description ?? task.group;
  // 列表已按来源分组, 行内不再重复来源 badge; 只保留「隐藏」这类附加语义。
  return {
    ...(task.hidden
      ? {
          badges: [
            {
              label: i18next.t("commandPalette.run.taskTab.hidden"),
              variant: "outline" as const,
            },
          ],
        }
      : {}),
    detail: task.unsupportedReason ?? commandDetail(task),
    disabled: Boolean(task.unsupportedReason),
    id: task.id,
    searchTerms: [
      task.label,
      task.source,
      task.description,
      task.group,
      task.cwd,
      commandDetail(task),
      ...(task.tags ?? []),
    ].filter((value): value is string => typeof value === "string"),
    label: task.label,
    ...(description ? { description } : {}),
  };
}

function buildTaskSections(result: TaskListResult): QuickPickSection[] {
  const sections: QuickPickSection[] = [];
  const bySource = new Map<TaskSource, QuickPickItem[]>();
  for (const task of result.tasks) {
    bySource.set(task.source, [
      ...(bySource.get(task.source) ?? []),
      taskItem(task),
    ]);
  }
  for (const [source, items] of bySource) {
    sections.push({
      heading: taskSourceLabel(source),
      id: source,
      items,
    });
  }
  if (result.errors.length > 0) {
    sections.push({
      heading: i18next.t("commandPalette.run.section.taskErrors"),
      id: "errors",
      items: result.errors.map((error) => ({
        disabled: true,
        id: `error:${error.source}`,
        label: taskSourceLabel(error.source),
        detail: error.message,
      })),
    });
  }
  return sections;
}

async function collectTaskInputs(
  inputs: readonly TaskInputRequest[]
): Promise<Record<string, string> | null> {
  const values: Record<string, string> = {};
  for (const input of inputs) {
    if (input.type === "promptString") {
      // biome-ignore lint/suspicious/noAlert: command palette does not yet expose a text-input quick pick.
      const value = window.prompt(
        input.description ?? input.id,
        input.default ?? ""
      );
      if (value === null) {
        return null;
      }
      values[input.id] = value;
      continue;
    }
    const selected = await new Promise<string | null>((resolve) => {
      useCommandPaletteController.getState().openQuickPick({
        title: input.description ?? input.id,
        placeholder: input.description ?? input.id,
        items: input.options.map((option) => ({
          checked: option === input.default,
          id: option,
          label: option,
        })),
        onAccept: (item) => {
          resolve(item.id);
        },
        onDismiss: () => {
          resolve(null);
        },
      });
    });
    if (selected === null) {
      return null;
    }
    values[input.id] = selected;
  }
  return values;
}

async function spawnTask(args: {
  inputs?: Record<string, string>;
  projectRoot: string;
  taskId: string;
}): Promise<TaskSpawnResult> {
  return await window.pier.tasks.spawn({
    focus: true,
    ...(args.inputs ? { inputs: args.inputs } : {}),
    placement: "active-tab",
    projectRoot: args.projectRoot,
    taskId: args.taskId,
  });
}

function focusTerminalPanel(panelId: string): void {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return;
  }
  const result = activateWorkspacePanel(api, panelId, {
    expectedKind: "terminal",
    kindOfComponent: panelKindOf,
    reveal: "always",
  });
  if (!result.ok) {
    console.error("[run-actions] focus task terminal failed:", result.message);
  }
}
async function spawnTaskWithInputFlow(
  projectRoot: string,
  taskId: string
): Promise<void> {
  let result = await spawnTask({ projectRoot, taskId });
  if (result.status === "requires-input") {
    const inputs = await collectTaskInputs(result.inputs);
    if (!inputs) {
      return;
    }
    result = await spawnTask({ inputs, projectRoot, taskId });
  }
  if (result.status === "unsupported") {
    console.error("[run-actions] task unsupported:", result.message);
    return;
  }
  if (result.status === "already-running") {
    focusTerminalPanel(result.panelId);
  }
}

function handleTaskAccept(projectRoot: string, item: QuickPickItem) {
  return spawnTaskWithInputFlow(projectRoot, item.id);
}

/**
 * 任务面板右键"重新运行": 复用 Run Task 的 spawn 流程。main 侧 prepareSpawn
 * 会走 restart 路径 — 运行中的任务先取消再在原 panel 重启, 已结束的任务
 * 直接复用原 panel relaunch。
 */
async function rerunActiveTaskPanel(): Promise<void> {
  const task = activeTaskPanelMetadata();
  if (!task) {
    return;
  }
  await spawnTaskWithInputFlow(task.projectRoot, task.taskId);
}
export async function openRunTaskQuickPick() {
  const projectRoot = activeProjectRoot();
  const title = i18next.t("commandPalette.action.runTask");
  const placeholder = i18next.t("commandPalette.placeholder.runTask");
  if (!projectRoot) {
    useCommandPaletteController.getState().openQuickPick({
      title,
      placeholder,
      items: [
        {
          detail: i18next.t("commandPalette.run.noTaskContextDetail"),
          disabled: true,
          id: "task-no-context",
          label: i18next.t("commandPalette.run.noTaskContext"),
        },
      ],
      onAccept: () => undefined,
    });
    return;
  }
  let cancelled = false;
  useCommandPaletteController.getState().openQuickPick({
    title,
    placeholder,
    loading: true,
    items: [
      {
        detail: i18next.t("commandPalette.run.loadingTasksDetail"),
        disabled: true,
        id: "task-loading",
        label: i18next.t("commandPalette.run.loadingTasks"),
      },
    ],
    onAccept: () => undefined,
    onDismiss: () => {
      cancelled = true;
    },
  });
  const requestId = useCommandPaletteController.getState().requestId;
  const shouldReplaceLoadingPick = () => {
    const state = useCommandPaletteController.getState();
    return (
      !cancelled &&
      state.open &&
      state.mode === "quick-pick" &&
      state.requestId === requestId
    );
  };
  // 让出一个 macrotask, 先 paint loading row, 再触发 cold task discovery。
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (!shouldReplaceLoadingPick()) {
    return;
  }
  try {
    const result = await window.pier.tasks.list({ projectRoot });
    if (!shouldReplaceLoadingPick()) {
      return;
    }
    const sections = buildTaskSections(result);
    useCommandPaletteController.getState().replaceQuickPick({
      title,
      placeholder,
      ...(sections.length > 0
        ? { sections }
        : {
            items: [
              {
                detail: i18next.t("commandPalette.run.noTasksDetail"),
                disabled: true,
                id: "task-empty",
                label: i18next.t("commandPalette.run.noTasks"),
              },
            ],
          }),
      onAccept: (item) => handleTaskAccept(projectRoot, item),
    });
  } catch (error) {
    if (!shouldReplaceLoadingPick()) {
      return;
    }
    useCommandPaletteController.getState().replaceQuickPick({
      title,
      placeholder,
      items: [
        {
          detail: error instanceof Error ? error.message : String(error),
          disabled: true,
          id: "task-load-error",
          label: i18next.t("commandPalette.run.loadFailed"),
        },
      ],
      onAccept: () => undefined,
    });
  }
}

function openTerminalListQuickPick() {
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
}

export const RUN_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  {
    categoryKey: "run",
    group: "1_run",
    handler: openRunTaskQuickPick,
    iconComponent: Play,
    id: "pier.run.task",
    sortOrder: 0,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.runTask",
  },
  {
    categoryKey: "run",
    // 与 pier.panel.newTerminal 同组同位: 任务面板上二者互斥换位。
    group: "1_new",
    handler: rerunActiveTaskPanel,
    iconComponent: RotateCcw,
    id: "pier.run.rerunTask",
    menuHiddenWhen: "!terminal.activeIsTaskPanel",
    sortOrder: 1,
    surfaces: ["dockview-tab", "terminal/content"],
    titleKey: "contextMenu.action.rerunTask",
    when: "terminal.activeIsTaskPanel",
  },
  {
    categoryKey: "run",
    group: "1_run",
    handler: openTerminalListQuickPick,
    iconComponent: List,
    id: "pier.run.terminalList",
    sortOrder: 2,
    surfaces: ["command-palette"],
    titleKey: "commandPalette.action.terminalList",
    when: "workspace.hasApi",
  },
];

export function registerRunActions(): () => void {
  const disposers = registerActionContributions(
    RUN_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
