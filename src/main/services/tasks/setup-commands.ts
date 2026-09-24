import type { TaskCandidate, TaskSource } from "@shared/contracts/tasks.ts";
import { taskCandidate as candidate } from "./candidate.ts";
import {
  type CommandExists,
  commandWithArgs,
  executableOnPath,
  filterAvailableCommands,
} from "./utils.ts";

/**
 * 清单里没有、但打开项目后几乎都要跑的准备命令（mise trust、pnpm install）。
 * id 用 setup 段，避免和同名脚本撞 id。本机没有对应可执行文件时不列出。
 */
function setupTask(args: {
  command: string;
  cwd: string;
  declaredLabels: ReadonlySet<string>;
  idParts: readonly string[];
  label: string;
  source: TaskSource;
  tags?: string[];
}): TaskCandidate {
  return candidate({
    commandSpec: { command: args.command, kind: "shell" },
    cwd: args.cwd,
    idParts: args.idParts,
    label: args.declaredLabels.has(args.label) ? args.command : args.label,
    source: args.source,
    ...(args.tags && args.tags.length > 0 ? { tags: args.tags } : {}),
  });
}

async function available(
  tasks: readonly TaskCandidate[],
  commandExists: CommandExists | undefined
): Promise<TaskCandidate[]> {
  return filterAvailableCommands(tasks, commandExists ?? executableOnPath);
}

export function packageManagerSetupTasks(args: {
  commandExists?: CommandExists | undefined;
  declaredLabels: ReadonlySet<string>;
  manager: string;
  projectRootPath: string;
}): Promise<TaskCandidate[]> {
  const command = commandWithArgs(args.manager, ["install"]);
  return available(
    [
      setupTask({
        command,
        cwd: args.projectRootPath,
        declaredLabels: args.declaredLabels,
        idParts: ["package-script", "setup", "install"],
        label: "install",
        source: "package-script",
        tags: ["package", args.manager],
      }),
    ],
    args.commandExists
  );
}

export function miseSetupTasks(args: {
  commandExists?: CommandExists | undefined;
  declaredLabels: ReadonlySet<string>;
  projectRootPath: string;
}): Promise<TaskCandidate[]> {
  return available(
    [
      setupTask({
        command: commandWithArgs("mise", ["trust"]),
        cwd: args.projectRootPath,
        declaredLabels: args.declaredLabels,
        idParts: ["mise", "setup", "trust"],
        label: "trust",
        source: "mise",
      }),
      setupTask({
        command: commandWithArgs("mise", ["install"]),
        cwd: args.projectRootPath,
        declaredLabels: args.declaredLabels,
        idParts: ["mise", "setup", "install"],
        label: "install",
        source: "mise",
      }),
    ],
    args.commandExists
  );
}

export function composerSetupTasks(args: {
  commandExists?: CommandExists | undefined;
  declaredLabels: ReadonlySet<string>;
  projectRootPath: string;
}): Promise<TaskCandidate[]> {
  return available(
    [
      setupTask({
        command: commandWithArgs("composer", ["install"]),
        cwd: args.projectRootPath,
        declaredLabels: args.declaredLabels,
        idParts: ["composer", "setup", "install"],
        label: "install",
        source: "composer",
        tags: ["php"],
      }),
    ],
    args.commandExists
  );
}
