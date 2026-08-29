import type {
  TaskCandidate,
  TaskListResult,
  TaskSource,
  TaskSpawnMode,
  TaskSpawnResult,
} from "@shared/contracts/tasks.ts";
import { createLogger } from "@shared/logger.ts";
import i18next from "i18next";
import { List, Play } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import {
  projectPathActionDisabledReason,
  projectPathActionEnabled,
} from "@/lib/actions/project-path-action-gate.ts";
import { rendererActionContributionRuntime } from "@/lib/actions/renderer-action-runtime.ts";
import { TASK_RUN_ACTION_CONTRIBUTIONS } from "@/lib/actions/task-run-context-actions.ts";
import { openTerminalListQuickPick } from "@/lib/actions/terminal-list-quickpick.ts";
import type { ActionInvocation } from "@/lib/actions/types.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import type {
  QuickPickItem,
  QuickPickSection,
} from "@/lib/command-palette/types.ts";
import { reportTaskRuntimeDiagnostic } from "@/lib/tasks/report-runtime-diagnostic.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import {
  projectPathFromContext,
  resolvePanelPathAnchor,
} from "@/stores/workspace-panel-helpers.ts";
import { spawnTaskWithInputResolution } from "./task-input-flow.ts";
import { scheduleTaskOutputPanelSync } from "./task-output-sync.ts";

const log = createLogger("task.spawn.ui");

async function spawnTask(args: {
  forceRestart: boolean;
  inputs?: Record<string, string>;
  mode?: TaskSpawnMode;
  project: ProjectContext;
  skipMissingDependencies?: boolean;
  terminalPanelId?: string | undefined;
  taskId: string;
}): Promise<TaskSpawnResult> {
  const terminalPanelId =
    args.terminalPanelId ??
    (args.mode === "background" ? args.project.terminalPanelId : undefined);
  return await window.pier.tasks.spawn({
    focus: args.mode !== "background",
    forceRestart: args.forceRestart,
    ...(args.inputs ? { inputs: args.inputs } : {}),
    ...(args.mode === "background" ? { mode: args.mode } : {}),
    placement: "active-tab",
    projectRootPath: args.project.projectRootPath,
    ...(args.skipMissingDependencies ? { skipMissingDependencies: true } : {}),
    ...(terminalPanelId ? { terminalPanelId } : {}),
    ...(args.project.targetGroupId
      ? { targetGroupId: args.project.targetGroupId }
      : {}),
    taskId: args.taskId,
  });
}

interface ProjectContext {
  defaultTaskSpawnMode?: TaskSpawnMode;
  projectRootPath: string;
  targetGroupId?: string;
  terminalPanelId?: string;
}

function activeProjectContext(
  invocation?: ActionInvocation
): ProjectContext | null {
  const api = useWorkspaceStore.getState().api;
  const anchor = resolvePanelPathAnchor({
    api,
    sourcePanelContext: invocation?.sourcePanelContext,
    sourcePanelGroupId: invocation?.sourcePanelGroupId,
    sourcePanelId: invocation?.sourcePanelId,
  });
  const projectRootPath = projectPathFromContext(anchor.context);
  if (!projectRootPath) {
    return null;
  }
  const sourcePanelId =
    invocation?.sourcePanelId ?? api?.activePanel?.id ?? undefined;
  const sourcePanel = sourcePanelId
    ? api?.panels.find((panel) => panel.id === sourcePanelId)
    : api?.activePanel;
  const resolvedTargetGroupId =
    invocation?.sourcePanelGroupId ?? anchor.groupId ?? api?.activeGroup?.id;
  return {
    defaultTaskSpawnMode:
      sourcePanel?.view.contentComponent === "terminal"
        ? "background"
        : "terminal-tab",
    projectRootPath,
    ...(sourcePanel?.view.contentComponent === "terminal"
      ? { terminalPanelId: sourcePanel.id }
      : {}),
    ...(resolvedTargetGroupId ? { targetGroupId: resolvedTargetGroupId } : {}),
  };
}

const TASK_SOURCE_I18N_KEYS = {
  cargo: "commandPalette.run.taskTab.source.cargo",
  cmake: "commandPalette.run.taskTab.source.cmake",
  composer: "commandPalette.run.taskTab.source.composer",
  deno: "commandPalette.run.taskTab.source.deno",
  dotnet: "commandPalette.run.taskTab.source.dotnet",
  go: "commandPalette.run.taskTab.source.go",
  gradle: "commandPalette.run.taskTab.source.gradle",
  history: "commandPalette.run.taskTab.source.history",
  just: "commandPalette.run.taskTab.source.just",
  make: "commandPalette.run.taskTab.source.make",
  maven: "commandPalette.run.taskTab.source.maven",
  mise: "commandPalette.run.taskTab.source.mise",
  mix: "commandPalette.run.taskTab.source.mix",
  "package-script": "commandPalette.run.taskTab.source.packageScript",
  pubspec: "commandPalette.run.taskTab.source.pubspec",
  pyproject: "commandPalette.run.taskTab.source.pyproject",
  sbt: "commandPalette.run.taskTab.source.sbt",
  swiftpm: "commandPalette.run.taskTab.source.swiftpm",
  taskfile: "commandPalette.run.taskTab.source.taskfile",
  vscode: "commandPalette.run.taskTab.source.vscode",
  zed: "commandPalette.run.taskTab.source.zed",
  zig: "commandPalette.run.taskTab.source.zig",
} as const satisfies Record<TaskSource, string>;

function taskSourceLabel(source: TaskSource): string {
  return i18next.t(TASK_SOURCE_I18N_KEYS[source]);
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

async function spawnTaskWithInputFlow(
  project: ProjectContext,
  taskId: string,
  options: {
    forceRestart: boolean;
    mode?: TaskSpawnMode;
    terminalPanelId?: string | undefined;
  }
): Promise<void> {
  const mode = options.mode ?? project.defaultTaskSpawnMode ?? "terminal-tab";
  const beginCtx = {
    mode,
    projectRootPath: project.projectRootPath,
    taskId,
    terminalPanelId: options.terminalPanelId ?? project.terminalPanelId,
  };
  log.info("ui spawn begin", beginCtx);
  reportTaskRuntimeDiagnostic("task.spawn.ui", "ui spawn begin", beginCtx);
  try {
    const result = await spawnTaskWithInputResolution((call) =>
      spawnTask({
        ...(call?.inputs ? { inputs: call.inputs } : {}),
        ...(call?.skipMissingDependencies
          ? { skipMissingDependencies: true }
          : {}),
        project,
        taskId,
        ...options,
      })
    );
    if (!result) {
      log.info("ui spawn cancelled/empty result", { taskId });
      return;
    }
    const resultCtx = {
      mode,
      runId: "runId" in result ? result.runId : undefined,
      status: result.status,
      taskId,
      terminalPanelId: options.terminalPanelId ?? project.terminalPanelId,
    };
    log.info("ui spawn result", resultCtx);
    reportTaskRuntimeDiagnostic("task.spawn.ui", "ui spawn result", resultCtx);
    if (
      result.status === "unsupported" ||
      result.status === "missing-dependencies"
    ) {
      await showAppAlert({
        body: result.message,
        title: i18next.t("commandPalette.run.startFailed"),
      });
      return;
    }
    if (result.status === "started") {
      // Pull after IPC reply so store is not racing the broadcast for RC mount.
      try {
        const pull = window.pier.tasks.runsSnapshot;
        if (typeof pull === "function") {
          const snapshot = await pull();
          useTaskRunsStore.getState().apply(snapshot);
          log.info("ui spawn post-pull TaskRuns", {
            runCount: Object.keys(snapshot.runs).length,
            runIds: Object.keys(snapshot.runs),
            version: snapshot.version,
          });
        }
      } catch (error) {
        log.warn("ui spawn post-pull TaskRuns failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      scheduleTaskOutputPanelSync();
    }
  } catch (error) {
    log.warn("ui spawn threw", {
      error: error instanceof Error ? error.message : String(error),
      taskId,
    });
    await showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: i18next.t("commandPalette.run.startFailed"),
    });
  }
}

function handleTaskAccept(project: ProjectContext, item: QuickPickItem) {
  // 与控制条「重新运行」同语义：未关闭的同任务复用 / 顶替旧 run，不另开 tab。
  return spawnTaskWithInputFlow(project, item.id, {
    forceRestart: true,
    mode: project.defaultTaskSpawnMode ?? "terminal-tab",
  });
}

export async function openRunTaskQuickPick(invocation?: ActionInvocation) {
  const project = activeProjectContext(invocation);
  const title = i18next.t("commandPalette.action.runTask");
  const placeholder = i18next.t("commandPalette.placeholder.runTask");
  if (!project) {
    // 入口 action 在无路径时已 disabled；快捷键 toast 由 keybinding 层处理。
    // 若仍走到此处（旧调用），保持 quick-pick 空态作为兜底。
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
    showAppAlert({
      body: error instanceof Error ? error.message : String(error),
      title: i18next.t("commandPalette.run.loadFailed"),
    });
    return;
  }
}

export const RUN_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  ...TASK_RUN_ACTION_CONTRIBUTIONS,
  {
    categoryKey: "run",
    disabledReason: projectPathActionDisabledReason,
    enabled: projectPathActionEnabled,
    group: "1_run",
    handler: openRunTaskQuickPick,
    iconComponent: Play,
    id: "pier.run.task",
    sortOrder: 0,
    surfaces: ["command-palette", "create-menu"],
    titleKey: "commandPalette.action.runTask",
    when: "workspace.hasApi",
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
