import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { looksLikePierAppCliTarget } from "./paths.ts";

export type AppCliEntryKind = "file" | "missing" | "other" | "symlink";

export interface AppCliFs {
  canWrite(path: string): boolean;
  existsDir(path: string): boolean;
  existsFile(path: string): boolean;
  kind(path: string): AppCliEntryKind;
  mkdirp(path: string): void;
  readlink(path: string): string;
  realpath(path: string): string;
  symlink(target: string, path: string): void;
  unlink(path: string): void;
}

function errnoCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
  }
  return;
}

export function createNodeAppCliFs(): AppCliFs {
  return {
    canWrite(path) {
      try {
        accessSync(path, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
    existsDir(path) {
      try {
        return lstatSync(path).isDirectory();
      } catch {
        return false;
      }
    },
    existsFile(path) {
      try {
        return lstatSync(path).isFile();
      } catch {
        return false;
      }
    },
    kind(path) {
      try {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          return "symlink";
        }
        if (stat.isFile()) {
          return "file";
        }
        return "other";
      } catch {
        return "missing";
      }
    },
    mkdirp(path) {
      mkdirSync(path, { recursive: true });
    },
    readlink(path) {
      return readlinkSync(path);
    },
    realpath(path) {
      return realpathSync(path);
    },
    symlink(target, path) {
      symlinkSync(target, path);
    },
    unlink(path) {
      unlinkSync(path);
    },
  };
}

export function parentDir(path: string): string {
  return dirname(path);
}

export function isOurCliLink(
  fs: AppCliFs,
  linkPath: string,
  sourcePath: string
): boolean {
  if (fs.kind(linkPath) !== "symlink") {
    return false;
  }
  try {
    return fs.realpath(linkPath) === fs.realpath(sourcePath);
  } catch {
    return looksLikePierAppCliTarget(fs.readlink(linkPath));
  }
}

export function errnoFromUnknown(err: unknown): string | undefined {
  return errnoCode(err);
}
