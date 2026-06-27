import { access, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

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

export async function packageManagerFor(projectRoot: string): Promise<string> {
  if (await pathExists(join(projectRoot, "bun.lock"))) {
    return "bun";
  }
  if (await pathExists(join(projectRoot, "bun.lockb"))) {
    return "bun";
  }
  if (await pathExists(join(projectRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await pathExists(join(projectRoot, "yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

export function projectBasename(projectRoot: string): string {
  return basename(projectRoot) || projectRoot;
}

export function sourceHeading(source: string): string {
  return source
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
