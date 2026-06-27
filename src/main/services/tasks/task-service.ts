import { basename } from "node:path";
import {
  TASK_EXIT_TITLE_PREFIX,
  type TaskCandidate,
  type TaskInputRequest,
  type TaskLaunchPlan,
  type TaskListResult,
  type TaskRecentEntry,
  type TaskRecentState,
  type TaskSource,
  type TaskSpawnPreparation,
} from "@shared/contracts/tasks.ts";
import {
  EMPTY_TASK_RECENT_STATE,
  readTaskRecentState as readTaskRecentStateDefault,
  writeTaskRecentState as writeTaskRecentStateDefault,
} from "../../state/task-recent.ts";
import {
  type CollectTaskCandidatesOptions,
  collectTaskCandidates,
} from "./task-sources.ts";
import { commandWithArgs, projectBasename, shellQuote } from "./utils.ts";

export interface TaskSpawnRequest {
  inputs?: Record<string, string> | undefined;
  projectRoot: string;
  taskId: string;
}

export interface TaskStartedRecord {
  panelId: string;
  projectRoot: string;
  taskId: string;
}

export interface TaskService {
  list(args: { projectRoot: string }): Promise<TaskListResult>;
  markPanelClosed(panelId: string): void;
  prepareSpawn(args: TaskSpawnRequest): Promise<TaskSpawnPreparation>;
  recentTasks(): readonly TaskRecentEntry[];
  recordRecent(launch: TaskLaunchPlan): Promise<void>;
  recordStarted(record: TaskStartedRecord): void;
}

export interface CreateTaskServiceOptions {
  homeDir?: string;
  now?: () => number;
  readRecentState?: () => Promise<TaskRecentState>;
  recentLimit?: number;
  writeRecentState?: (state: TaskRecentState) => Promise<void>;
}

interface TaskRunInstance {
  panelId: string;
  projectRoot: string;
  startedAt: number;
  taskId: string;
}

const VARIABLE_RE = /\$\{([^}]+)\}/g;

const TASK_SOURCE_LABELS: Record<TaskSource, string> = {
  cargo: "Cargo",
  history: "Recently Run",
  just: "Justfile",
  make: "Makefile",
  mise: "mise",
  "package-script": "package.json",
  pyproject: "pyproject.toml",
  taskfile: "Taskfile",
  vscode: "VS Code",
  zed: "Zed",
};

function runKey(projectRoot: string, taskId: string): string {
  return `${projectRoot}\0${taskId}`;
}

function taskByLabel(
  tasks: readonly TaskCandidate[]
): Map<string, TaskCandidate> {
  const map = new Map<string, TaskCandidate>();
  for (const task of tasks) {
    map.set(task.label, task);
  }
  return map;
}

function inputRequestById(task: TaskCandidate): Map<string, TaskInputRequest> {
  return new Map((task.inputs ?? []).map((input) => [input.id, input]));
}

function requiredInputs(
  task: TaskCandidate,
  provided: Record<string, string>
): TaskInputRequest[] {
  const requests = inputRequestById(task);
  const missing = new Set<string>();
  for (const value of valuesWithVariables(task)) {
    for (const match of value.matchAll(VARIABLE_RE)) {
      const token = match[1];
      if (!token?.startsWith("input:")) {
        continue;
      }
      const id = token.slice("input:".length);
      if (!(id in provided)) {
        missing.add(id);
      }
    }
  }
  return [...missing].flatMap((id) => {
    const request = requests.get(id);
    return request ? [request] : [];
  });
}

function valuesWithVariables(task: TaskCandidate): string[] {
  return [
    task.cwd,
    task.commandSpec.command,
    task.commandSpec.kind === "process" ? task.commandSpec.args.join(" ") : "",
    ...Object.values(task.env ?? {}),
  ];
}

function resolveVariables(
  value: string,
  context: {
    inputs: Record<string, string>;
    projectRoot: string;
  }
): string {
  return value.replace(VARIABLE_RE, (_full, token: string) => {
    if (token === "workspaceFolder" || token === "workspaceRoot") {
      return context.projectRoot;
    }
    if (token === "workspaceFolderBasename") {
      return projectBasename(context.projectRoot);
    }
    if (token === "cwd") {
      return context.projectRoot;
    }
    if (token.startsWith("env:")) {
      return process.env[token.slice("env:".length)] ?? "";
    }
    if (token.startsWith("input:")) {
      return context.inputs[token.slice("input:".length)] ?? "";
    }
    if (
      token === "file" ||
      token === "relativeFile" ||
      token.startsWith("command:")
    ) {
      throw new Error(`无法解析变量: \${${token}}`);
    }
    return "";
  });
}

function resolvedEnv(
  task: TaskCandidate,
  context: { inputs: Record<string, string>; projectRoot: string }
): Record<string, string> | undefined {
  const entries = Object.entries(task.env ?? {}).map(([key, value]) => [
    key,
    resolveVariables(value, context),
  ]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function buildCommand(
  task: TaskCandidate,
  context: { inputs: Record<string, string>; projectRoot: string }
): string {
  if (task.commandSpec.kind === "process") {
    return commandWithArgs(
      resolveVariables(task.commandSpec.command, context),
      [...task.commandSpec.args.map((arg) => resolveVariables(arg, context))]
    );
  }
  return resolveVariables(task.commandSpec.command, context);
}

function withPresentation(command: string, task: TaskCandidate): string {
  const parts: string[] = [];
  if (task.presentation?.clear) {
    parts.push("clear");
  }
  if (task.presentation?.showCommand) {
    parts.push(`printf '%s\\n' ${shellQuote(`+ ${command}`)}`);
  }
  parts.push(command);
  parts.push("code=$?");
  parts.push(`printf '\\033]0;${TASK_EXIT_TITLE_PREFIX}%s\\007' "$code"`);
  if (task.presentation?.showSummary) {
    parts.push("printf '\\n[pier] task exited with %s\\n' \"$code\"");
  }
  parts.push('exit "$code"');
  return parts.join("; ");
}

function launchForTask(
  task: TaskCandidate,
  context: { inputs: Record<string, string>; projectRoot: string }
): TaskLaunchPlan {
  const cwd = resolveVariables(task.cwd, context);
  const rawCommand = buildCommand(task, context);
  const command = withPresentation(rawCommand, task);
  const env = resolvedEnv(task, context);
  const sourceLabel = TASK_SOURCE_LABELS[task.source];
  return {
    command,
    cwd,
    focus: task.presentation?.focus ?? task.presentation?.reveal !== "never",
    label: task.label,
    presentation: task.presentation ?? {},
    projectRoot: context.projectRoot,
    tab: {
      badge: { label: sourceLabel },
      icon: { id: "pier.task", label: "Task" },
      state: { busy: true, label: "Running" },
      title: task.label,
      tooltip: {
        lines: [
          { label: "Source", value: sourceLabel },
          { label: "Command", value: rawCommand },
          { label: "CWD", value: cwd },
        ],
        title: task.label,
      },
    },
    taskId: task.id,
    ...(env ? { env } : {}),
  };
}

function dependencyTasks(
  task: TaskCandidate,
  labels: ReadonlyMap<string, TaskCandidate>
): TaskCandidate[] {
  return (task.dependsOn ?? []).flatMap((label) => {
    const dependency = labels.get(label);
    return dependency ? [dependency] : [];
  });
}

function expandLaunchOrder(
  task: TaskCandidate,
  labels: ReadonlyMap<string, TaskCandidate>
): TaskCandidate[] {
  const visited = new Set<string>();
  const ordered: TaskCandidate[] = [];
  const visit = (current: TaskCandidate) => {
    if (visited.has(current.id)) {
      return;
    }
    visited.add(current.id);
    for (const dependency of dependencyTasks(current, labels)) {
      visit(dependency);
    }
    ordered.push(current);
  };
  visit(task);
  return ordered;
}

export function createTaskService({
  homeDir,
  now = () => Date.now(),
  readRecentState = readTaskRecentStateDefault,
  recentLimit = 20,
  writeRecentState = writeTaskRecentStateDefault,
}: CreateTaskServiceOptions = {}): TaskService {
  const runningByKey = new Map<string, TaskRunInstance>();
  const runningByPanel = new Map<string, string>();
  let recentTasks: TaskRecentEntry[] = [];
  let recentLoaded = false;
  let recentLoadPromise: Promise<void> | null = null;

  async function ensureRecentLoaded(): Promise<void> {
    if (recentLoaded) {
      return;
    }
    if (recentLoadPromise) {
      return await recentLoadPromise;
    }
    recentLoadPromise = readRecentState()
      .then((state) => {
        recentTasks = state.entries;
        recentLoaded = true;
      })
      .catch(() => {
        recentTasks = EMPTY_TASK_RECENT_STATE.entries;
        recentLoaded = true;
      })
      .finally(() => {
        recentLoadPromise = null;
      });
    await recentLoadPromise;
  }

  const collect = async (projectRoot: string) => {
    await ensureRecentLoaded();
    return await collectTaskCandidates({
      projectRoot,
      recentTasks,
      ...(homeDir ? { homeDir } : {}),
    } satisfies CollectTaskCandidatesOptions);
  };

  return {
    async list({ projectRoot }) {
      return await collect(projectRoot);
    },
    markPanelClosed(panelId) {
      const key = runningByPanel.get(panelId);
      if (!key) {
        return;
      }
      runningByPanel.delete(panelId);
      runningByKey.delete(key);
    },
    async prepareSpawn({ projectRoot, taskId, inputs = {} }) {
      const list = await collect(projectRoot);
      const task = list.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        return {
          message: `找不到任务: ${taskId}`,
          status: "unsupported",
        };
      }
      if (task.unsupportedReason) {
        return {
          message: task.unsupportedReason,
          status: "unsupported",
        };
      }
      if (task.concurrencyPolicy === "dedupe") {
        const running = runningByKey.get(runKey(projectRoot, task.id));
        if (running) {
          return {
            panelId: running.panelId,
            status: "already-running",
          };
        }
      }
      const missingInputs = requiredInputs(task, inputs);
      if (missingInputs.length > 0) {
        return {
          inputs: missingInputs,
          status: "requires-input",
        };
      }
      try {
        const labels = taskByLabel(list.tasks);
        const launches = expandLaunchOrder(task, labels).map((entry) =>
          launchForTask(entry, { inputs, projectRoot })
        );
        return {
          launches,
          status: "ready",
        };
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : String(error),
          status: "unsupported",
        };
      }
    },
    recentTasks: () => recentTasks,
    async recordRecent(launch) {
      await ensureRecentLoaded();
      const entry: TaskRecentEntry = {
        command: launch.command,
        cwd: launch.cwd,
        label: launch.label || basename(launch.cwd),
        source: "history",
      };
      recentTasks = [
        entry,
        ...recentTasks.filter(
          (recent) =>
            !(recent.cwd === entry.cwd && recent.command === entry.command)
        ),
      ].slice(0, recentLimit);
      await writeRecentState({ entries: recentTasks, version: 1 });
    },
    recordStarted({ panelId, projectRoot, taskId }) {
      const key = runKey(projectRoot, taskId);
      runningByKey.set(key, {
        panelId,
        projectRoot,
        startedAt: now(),
        taskId,
      });
      runningByPanel.set(panelId, key);
    },
  };
}
