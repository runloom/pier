import {
  TASK_EXIT_TITLE_PREFIX,
  type TaskCandidate,
  type TaskInputRequest,
  type TaskLaunchPlan,
  type TaskSource,
} from "@shared/contracts/tasks.ts";
import { commandWithArgs, projectBasename, shellQuote } from "./utils.ts";

const VARIABLE_RE = /\$\{([^}]+)\}/g;

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

function taskBySourceLabel(
  tasks: readonly TaskCandidate[]
): Map<string, TaskCandidate> {
  const map = new Map<string, TaskCandidate>();
  for (const task of tasks) {
    const key = taskLabelKey(task.source, task.label);
    if (map.has(key)) {
      throw new Error(`任务标签重复: ${task.source} ${task.label}`);
    }
    map.set(key, task);
  }
  return map;
}

function dependencyTask(
  task: TaskCandidate,
  dependencyLabel: string,
  labels: ReadonlyMap<string, TaskCandidate>
): TaskCandidate {
  const dependency = labels.get(taskLabelKey(task.source, dependencyLabel));
  if (!dependency) {
    throw new Error(`任务 ${task.label} 依赖不存在: ${dependencyLabel}`);
  }
  return dependency;
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

function resolveVariables(
  value: string,
  context: {
    inputs: Record<string, string>;
    projectRootPath: string;
  }
): string {
  return value.replace(VARIABLE_RE, (_full, token: string) => {
    if (token === "workspaceFolder" || token === "workspaceRoot") {
      return context.projectRootPath;
    }
    if (token === "workspaceFolderBasename") {
      return projectBasename(context.projectRootPath);
    }
    if (token === "cwd") {
      return context.projectRootPath;
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

function shellCommand(script: string): string {
  return `/bin/sh -lc ${shellQuote(script)}`;
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
  return shellCommand(parts.join("; "));
}

function launchForTask(
  task: TaskCandidate,
  context: TaskExecutionContext,
  labels: ReadonlyMap<string, TaskCandidate>
): TaskLaunchPlan {
  const cwd = resolveVariables(task.cwd, context);
  const rawCommand = buildCommand(task, context);
  const command = withPresentation(rawCommand, task);
  const env = resolvedEnv(task, context);
  const sourceLabel = TASK_SOURCE_LABELS[task.source];
  const dependsOn = task.dependsOn?.map(
    (dependencyLabel) => dependencyTask(task, dependencyLabel, labels).id
  );
  return {
    command,
    cwd,
    ...(dependsOn ? { dependsOn } : {}),
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

function dependencyTasks(
  task: TaskCandidate,
  labels: ReadonlyMap<string, TaskCandidate>
): TaskCandidate[] {
  return (task.dependsOn ?? []).map((label) =>
    dependencyTask(task, label, labels)
  );
}

function expandLaunchOrder(
  task: TaskCandidate,
  labels: ReadonlyMap<string, TaskCandidate>
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
    for (const dependency of dependencyTasks(current, labels)) {
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
  tasks: readonly TaskCandidate[]
): TaskLaunchPlan[] {
  const labels = taskBySourceLabel(tasks);
  return expandLaunchOrder(task, labels).map((entry) =>
    launchForTask(entry, context, labels)
  );
}
