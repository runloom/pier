import { access, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { resolveAbsoluteOnPath } from "../process-environment/resolve-user-command-surface.ts";

const SHELL_SAFE_RE = /^[A-Za-z0-9_./:@%+=,-]+$/;

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readTextIfExists(path: string): Promise<string | null> {
  if (!(await pathExists(path))) {
    return null;
  }
  return await readFile(path, "utf8");
}

export function stripJsonComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
}

export function parseJsonc(input: string): unknown {
  return JSON.parse(stripJsonComments(input));
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function stableId(parts: readonly string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(":");
}

export function shellQuote(value: string): string {
  if (SHELL_SAFE_RE.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function commandWithArgs(
  command: string,
  args: readonly string[]
): string {
  if (args.length === 0) {
    return command;
  }
  return `${command} ${args.map(shellQuote).join(" ")}`;
}

export type CommandExists = (name: string) => boolean | Promise<boolean>;

/** 仓库里的包装脚本，从任务 cwd 启动，不要求出现在 PATH 上。 */
const PROJECT_LOCAL_WRAPPERS = new Set([
  "gradlew",
  "gradlew.bat",
  "mvnw",
  "mvnw.cmd",
]);

/** 命令行首个词。路径和项目包装脚本返回 null，表示不查 PATH。 */
export function commandExecutable(command: string): string | null {
  const token = command.trim().split(/\s+/u)[0];
  if (
    !token ||
    token.startsWith(".") ||
    token.includes("/") ||
    token.includes("\\") ||
    PROJECT_LOCAL_WRAPPERS.has(token.toLowerCase())
  ) {
    return null;
  }
  return token;
}

/**
 * 合成命令的可执行文件是否存在。
 * `pathEnv` 缺省是宿主进程 PATH；任务列表会传入项目 shell dump 的 PATH。
 */
export function executableOnPath(
  name: string,
  pathEnv: string = process.env.PATH ?? ""
): boolean {
  if (name.length === 0) {
    return false;
  }
  return resolveAbsoluteOnPath(name, pathEnv) !== null;
}

export async function filterAvailableCommands<
  T extends { commandSpec: { command: string } },
>(tasks: readonly T[], exists: CommandExists = executableOnPath): Promise<T[]> {
  const names = [
    ...new Set(
      tasks.flatMap((task) => {
        const name = commandExecutable(task.commandSpec.command);
        return name ? [name] : [];
      })
    ),
  ];
  const available = new Map<string, boolean>();
  await Promise.all(
    names.map(async (name) => {
      available.set(name, await exists(name));
    })
  );
  return tasks.filter((task) => {
    const name = commandExecutable(task.commandSpec.command);
    return name == null || available.get(name) === true;
  });
}

export async function packageManagerFor(
  projectRootPath: string
): Promise<string> {
  if (await pathExists(join(projectRootPath, "bun.lock"))) {
    return "bun";
  }
  if (await pathExists(join(projectRootPath, "bun.lockb"))) {
    return "bun";
  }
  if (await pathExists(join(projectRootPath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await pathExists(join(projectRootPath, "yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

export function projectBasename(projectRootPath: string): string {
  return basename(projectRootPath) || projectRootPath;
}

export function sourceHeading(source: string): string {
  return source
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
