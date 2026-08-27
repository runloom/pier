import type {
  TaskCandidate,
  TaskInputRequest,
  TaskLaunchPlan,
  TaskSource,
} from "@shared/contracts/tasks.ts";
import { shellFamily } from "../process-environment/resolve-user-command-probe.ts";
import { resolveWrapperShell } from "../process-environment/resolve-user-command-types.ts";
import { buildTaskPresentationScript } from "./presentation-script.ts";
import { commandWithArgs, projectBasename } from "./utils.ts";

const VARIABLE_RE = /\$\{([^}]+)\}/g;

/** Zed bare `$ZED_*` tokens (no braces); only known keys are expanded. */
const ZED_BARE_VARIABLE_RE = /\$([A-Z][A-Z0-9_]*)/g;

/** Map Zed / VS Code path tokens → project root. */
function workspaceRootForToken(
  token: string,
  projectRootPath: string
): string | undefined {
  if (
    token === "workspaceFolder" ||
    token === "workspaceRoot" ||
    token === "cwd" ||
    token === "ZED_WORKTREE_ROOT" ||
    token === "ZED_WORKTREE"
  ) {
    return projectRootPath;
  }
  if (token === "workspaceFolderBasename") {
    return projectBasename(projectRootPath);
  }
  return;
}

const TASK_SOURCE_LABELS: Record<TaskSource, string> = {
  cargo: "Cargo",
  composer: "Composer",
  deno: "Deno",
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

function taskLabelKey(source: TaskSource, label: string): string {
  return `${source}\0${label}`;
}

/**
 * 按 source+label 建依赖查找表。同 source 内 label 重复时保留先出现的条目
 * （列表顺序稳定），不抛错——启动是按 taskId 选中的，标签只用于 dependsOn 解析；
 * 硬拦会把 history 噪音或配置重复变成完全不可用。
 */
function taskBySourceLabel(
  tasks: readonly TaskCandidate[]
): Map<string, TaskCandidate> {
  const map = new Map<string, TaskCandidate>();
  for (const task of tasks) {
    const key = taskLabelKey(task.source, task.label);
    if (!map.has(key)) {
      map.set(key, task);
    }
  }
  return map;
}

/** 同 source 内 dependsOn label 找不到时抛出；UI 可确认后 skip 仅跑当前任务。 */
export class MissingTaskDependenciesError extends Error {
  readonly missingDependencies: readonly string[];
  readonly taskLabel: string;

  constructor(taskLabel: string, missingDependencies: readonly string[]) {
    const listed = missingDependencies.join(", ");
    super(`任务 ${taskLabel} 依赖不存在: ${listed}`);
    this.name = "MissingTaskDependenciesError";
    this.taskLabel = taskLabel;
    this.missingDependencies = missingDependencies;
  }
}

export interface BuildTaskLaunchesOptions {
  /** 为 true 时跳过找不到的 dependsOn，仍启动当前任务与可解析依赖。 */
  skipMissingDependencies?: boolean;
}

function resolveDependency(
  task: TaskCandidate,
  dependencyLabel: string,
  labels: ReadonlyMap<string, TaskCandidate>
): TaskCandidate | undefined {
  return labels.get(taskLabelKey(task.source, dependencyLabel));
}

function dependencyTasks(
  task: TaskCandidate,
  labels: ReadonlyMap<string, TaskCandidate>,
  options: BuildTaskLaunchesOptions
): TaskCandidate[] {
  const dependsOn = task.dependsOn ?? [];
  if (dependsOn.length === 0) {
    return [];
  }
  const resolved: TaskCandidate[] = [];
  const missing: string[] = [];
  for (const dependencyLabel of dependsOn) {
    const dependency = resolveDependency(task, dependencyLabel, labels);
    if (dependency) {
      resolved.push(dependency);
    } else {
      missing.push(dependencyLabel);
    }
  }
  if (missing.length > 0 && !options.skipMissingDependencies) {
    throw new MissingTaskDependenciesError(task.label, missing);
  }
  return resolved;
}

function inputRequestById(task: TaskCandidate): Map<string, TaskInputRequest> {
  return new Map((task.inputs ?? []).map((input) => [input.id, input]));
}

function valuesWithVariables(task: TaskCandidate): string[] {
  return [
    task.cwd,
    task.commandSpec.command,
    task.commandSpec.kind === "process" ? task.commandSpec.args.join(" ") : "",
    ...Object.values(task.env ?? {}),
  ];
}

export function requiredInputsForTask(
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

/**
 * Expand task string variables.
 * - VS Code style: `${workspaceFolder}`, `${env:FOO}`, `${input:id}`
 * - Zed style: `$ZED_WORKTREE_ROOT`, `$ZED_WORKTREE` (and braced forms)
 */
export function resolveVariables(
  value: string,
  context: {
    inputs: Record<string, string>;
    projectRootPath: string;
  }
): string {
  const braced = value.replace(VARIABLE_RE, (_full, token: string) => {
    const workspace = workspaceRootForToken(token, context.projectRootPath);
    if (workspace !== undefined) {
      return workspace;
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
  // Zed tasks.json commonly uses bare `$ZED_WORKTREE_ROOT` as cwd.
  return braced.replace(ZED_BARE_VARIABLE_RE, (full, token: string) => {
    const workspace = workspaceRootForToken(token, context.projectRootPath);
    return workspace ?? full;
  });
}

function resolvedEnv(
  task: TaskCandidate,
  context: TaskExecutionContext
): Record<string, string> | undefined {
  const entries = Object.entries(task.env ?? {}).map(([key, value]) => [
    key,
    resolveVariables(value, context),
  ]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function buildCommand(
  task: TaskCandidate,
  context: TaskExecutionContext
): string {
  if (task.commandSpec.kind === "process") {
    return commandWithArgs(
      resolveVariables(task.commandSpec.command, context),
      [...task.commandSpec.args.map((arg) => resolveVariables(arg, context))]
    );
  }
  return resolveVariables(task.commandSpec.command, context);
}

function withPresentation(
  command: string,
  task: TaskCandidate,
  env?: Record<string, string>
): string {
  // Inner script only. Visible tasks open Ghostty's default login shell
  // (same as an empty terminal) and type this via initialInput — `$SHELL -c`
  // is not a terminal and cannot enable zle / load .zshrc the same way.
  return buildTaskPresentationScript({
    command,
    family: shellFamily(resolveWrapperShell(env)),
    presentation: task.presentation ?? {},
  });
}

function launchForTask(
  task: TaskCandidate,
  context: TaskExecutionContext,
  labels: ReadonlyMap<string, TaskCandidate>,
  options: BuildTaskLaunchesOptions
): TaskLaunchPlan {
  let cwd = resolveVariables(task.cwd, context).trim();
  // Class A caller: cwd/env prepared for terminal/background spawn consumers.
  // Unexpanded placeholders or empty cwd must not reach spawn (Node reports
  // misleading "spawn shell ENOENT" when cwd is missing).
  if (cwd.length === 0 || cwd.includes("$")) {
    cwd = context.projectRootPath;
  }
  const rawCommand = buildCommand(task, context);
  const env = resolvedEnv(task, context);
  const command = withPresentation(rawCommand, task, env);
  const sourceLabel = TASK_SOURCE_LABELS[task.source];
  const dependsOn = dependencyTasks(task, labels, options).map(
    (dependency) => dependency.id
  );
  return {
    command,
    cwd,
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
    ...(task.dependsOrder ? { dependsOrder: task.dependsOrder } : {}),
    focus: task.presentation?.focus ?? task.presentation?.reveal !== "never",
    label: task.label,
    presentation: task.presentation ?? {},
    projectRootPath: context.projectRootPath,
    rawCommand,
    source: task.source,
    tab: {
      badge: { label: sourceLabel },
      icon: { id: "pier.task", label: "Task" },
      state: { label: "Running", status: "running" },
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

function expandLaunchOrder(
  task: TaskCandidate,
  labels: ReadonlyMap<string, TaskCandidate>,
  options: BuildTaskLaunchesOptions
): TaskCandidate[] {
  const visited = new Set<string>();
  const visiting: TaskCandidate[] = [];
  const ordered: TaskCandidate[] = [];
  const visit = (current: TaskCandidate) => {
    const cycleStart = visiting.findIndex((entry) => entry.id === current.id);
    if (cycleStart >= 0) {
      const cycle = [...visiting.slice(cycleStart), current]
        .map((entry) => entry.label)
        .join(" -> ");
      throw new Error(`任务依赖存在循环: ${cycle}`);
    }
    if (visited.has(current.id)) {
      return;
    }
    visiting.push(current);
    for (const dependency of dependencyTasks(current, labels, options)) {
      visit(dependency);
    }
    visiting.pop();
    visited.add(current.id);
    ordered.push(current);
  };
  visit(task);
  return ordered;
}

/** buildTaskLaunches / resolveVariables 的输入 context. */
export interface TaskExecutionContext {
  inputs: Record<string, string>;
  projectRootPath: string;
}

export function buildTaskLaunches(
  task: TaskCandidate,
  context: TaskExecutionContext,
  tasks: readonly TaskCandidate[],
  options: BuildTaskLaunchesOptions = {}
): TaskLaunchPlan[] {
  const labels = taskBySourceLabel(tasks);
  return expandLaunchOrder(task, labels, options).map((entry) =>
    launchForTask(entry, context, labels, options)
  );
}
