import { realpath as fsRealpath, stat as fsStat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  PanelOpenPathEntry,
  PierCommandErrorCode,
} from "@shared/contracts/commands.ts";

export interface ClassifiedPath {
  column?: number;
  kind: "directory" | "file";
  line?: number;
  path: string;
}

export type ClassifyPathResult =
  | ClassifiedPath
  | {
      error: {
        code: PierCommandErrorCode;
        message: string;
        osCode?: string;
      };
    };

function permissionDenied(path: string, osCode: string): ClassifyPathResult {
  return {
    error: {
      code: "permission_denied",
      message: `permission denied: ${path}`,
      osCode,
    },
  };
}

function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return;
  }
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

export async function realpathOrResolve(path: string): Promise<string> {
  try {
    return await fsRealpath(path);
  } catch {
    return resolve(path);
  }
}

export async function sameResolvedPath(
  left: string,
  right: string
): Promise<boolean> {
  return (await realpathOrResolve(left)) === (await realpathOrResolve(right));
}

export async function classifyPath(
  entry: PanelOpenPathEntry
): Promise<ClassifyPathResult> {
  let target = entry.path;
  try {
    target = await fsRealpath(entry.path);
  } catch (error) {
    const code = nodeErrorCode(error);
    if (code === "EACCES" || code === "EPERM") {
      return permissionDenied(entry.path, code);
    }
    if (code !== "ENOENT") {
      target = resolve(entry.path);
    }
  }
  try {
    const stats = await fsStat(target);
    if (stats.isDirectory()) {
      return { kind: "directory", path: target };
    }
    if (stats.isFile()) {
      return {
        kind: "file",
        path: target,
        ...(entry.line === undefined ? {} : { line: entry.line }),
        ...(entry.column === undefined ? {} : { column: entry.column }),
      };
    }
    return {
      error: {
        code: "invalid_command",
        message: `not a file or directory: ${entry.path}`,
      },
    };
  } catch (error) {
    const code = nodeErrorCode(error);
    if (code === "ENOENT") {
      return {
        error: {
          code: "not_found",
          message: `path not found: ${entry.path}. Pier does not create files. Create it first, then retry.`,
        },
      };
    }
    if (code === "EACCES" || code === "EPERM") {
      return permissionDenied(entry.path, code);
    }
    return {
      error: {
        code: "platform_unavailable",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
