import type {
  TaskCandidate,
  TaskListResult,
  TaskSource,
  TaskSpawnMode,
  TaskSpawnResult,
} from "@shared/contracts/tasks.ts";
import i18next from "i18next";
import { List, Play } from "lucide-react";
import { toast } from "sonner";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import { TASK_RUN_ACTION_CONTRIBUTIONS } from "@/lib/actions/task-run-context-actions.ts";
import { openTerminalListQuickPick } from "@/lib/actions/terminal-list-quickpick.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import type {
  QuickPickItem,
  QuickPickSection,
} from "@/lib/command-palette/types.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { spawnTaskWithInputResolution } from "./task-input-flow.ts";

const TASK_SPAWN_LOADING_DELAY_MS = 300;

type ToastId = string | number;

async function withTaskSpawnLoading<T>(
  taskLabel: string | undefined,
  operation: () => Promise<T>
): Promise<T> {
  let toastId: ToastId | undefined;
  let settled = false;
  const timer = window.setTimeout(() => {
    if (settled) {
      return;
    }
    toastId = toast.loading(
      taskLabel
        ? i18next.t("commandPalette.run.startingTaskWithLabel", {
            label: taskLabel,
          })
        : i18next.t("commandPalette.run.startingTask")
    );
  }, TASK_SPAWN_LOADING_DELAY_MS);
  try {
    return await operation();
  } finally {
    settled = true;
    window.clearTimeout(timer);
    if (toastId !== undefined) {
      toast.dismiss(toastId);
    }
  }
}

interface ProjectContext {
  defaultTaskSpawnMode?: TaskSpawnMode;
  projectRootPath: string;
  terminalPanelId?: string;
}

function activeProjectContext(): ProjectContext | null {
  const api = useWorkspaceStore.getState().api;
  const activePanel = api?.activePanel;
  const activePanelId = activePanel?.id;
  if (!activePanelId) {
    return null;
  }
  const descriptor =
    usePanelDescriptorStore.getState().descriptors[activePanelId];
  const projectRootPath =
    descriptor?.context?.projectRootPath ??
    descriptor?.context?.gitRoot ??
    descriptor?.context?.worktreeRoot ??
    descriptor?.context?.cwd;
  if (!projectRootPath) {
    return null;
  }
  return {
    defaultTaskSpawnMode:
      activePanel?.view.contentComponent === "terminal"
        ? "background"
        : "terminal-tab",
    projectRootPath,
    ...(activePanel?.view.contentComponent === "terminal"
      ? { terminalPanelId: activePanel.id }
      : {}),
  };
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

async function spawnTask(args: {
  forceRestart: boolean;
  inputs?: Record<string, string>;
  mode?: TaskSpawnMode;
  project: ProjectContext;
  terminalPanelId?: string | undefined;
  taskId: string;
  taskLabel?: string | undefined;
}): Promise<TaskSpawnResult> {
  return await withTaskSpawnLoading(args.taskLabel, async () => {
    const terminalPanelId =
      args.terminalPanelId ??
      (args.mode === "background" ? args.project.terminalPanelId : undefined);
    const result = await window.pier.tasks.spawn({
      focus: args.mode !== "background",
      forceRestart: args.forceRestart,
      ...(args.inputs ? { inputs: args.inputs } : {}),
      ...(args.mode === "background" ? { mode: args.mode } : {}),
      placement: "active-tab",
      projectRootPath: args.project.projectRootPath,
      ...(terminalPanelId ? { terminalPanelId } : {}),
      taskId: args.taskId,
    });
    return result;
  });
}

async function spawnTaskWithInputFlow(
  project: ProjectContext,
  taskId: string,
  options: {
    forceRestart: boolean;
    mode?: TaskSpawnMode;
    taskLabel?: string | undefined;
    terminalPanelId?: string | undefined;
  }
): Promise<void> {
  const result = await spawnTaskWithInputResolution((inputs) =>
    spawnTask({ ...(inputs ? { inputs } : {}), project, taskId, ...options })
  );
  if (!result) {
    return;
  }
  if (result.status === "unsupported") {
    console.error("[run-actions] task unsupported:", result.message);
    return;
  }
}

function handleTaskAccept(project: ProjectContext, item: QuickPickItem) {
  return spawnTaskWithInputFlow(project, item.id, {
    forceRestart: false,
    mode: project.defaultTaskSpawnMode ?? "terminal-tab",
    taskLabel: item.label,
  });
}

export async function openRunTaskQuickPick() {
  const project = activeProjectContext();
  const title = i18next.t("commandPalette.action.runTask");
  const placeholder = i18next.t("commandPalette.placeholder.runTask");
  if (!project) {
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
    const result = await window.pier.tasks.list({
      projectRootPath: project.projectRootPath,
    });
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
      onAccept: (item) => handleTaskAccept(project, item),
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

export const RUN_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  ...TASK_RUN_ACTION_CONTRIBUTIONS,
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
