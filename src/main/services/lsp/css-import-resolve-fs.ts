import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { CssImportFs } from "@shared/css-import-resolve.ts";
import { resolveCssImportPath } from "@shared/css-import-resolve.ts";

export function createNodeCssImportFs(): CssImportFs {
  return {
    exists(path) {
      return existsSync(path);
    },
    isDirectory(path) {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
    listDir(path) {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
    readJson(path) {
      try {
        return JSON.parse(readFileSync(path, "utf8")) as unknown;
      } catch {
        return null;
      }
    },
  };
}

const nodeFs = createNodeCssImportFs();

export function resolveCssImportOnDisk(input: {
  allowDirectory?: boolean;
  fromFilePath: string;
  specifier: string;
}): { isDirectory: boolean; path: string } | null {
  return resolveCssImportPath({
    ...(input.allowDirectory === undefined
      ? {}
      : { allowDirectory: input.allowDirectory }),
    fromFilePath: input.fromFilePath,
    fs: nodeFs,
    specifier: input.specifier,
  });
}
