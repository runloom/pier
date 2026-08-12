import {
  editorBasenameRulesFromMatrix,
  editorExtensionMapFromMatrix,
} from "@shared/language-matrix/index.ts";
import {
  isProjectCanvasPath,
  liveModuleProjectContentDirectories,
} from "@shared/live-module-canvas-path.ts";
import type { FilesDocumentLanguage } from "../document/types.ts";
import { editorLanguageModeRegistry } from "./language/mode-registry.ts";

/**
 * L0 extension → language map from the shared language matrix, plus box
 * languages that are not PATH rows (JS/TS/Vue live in special factories).
 */
const MATRIX_EXTENSION_TO_LANGUAGE = editorExtensionMapFromMatrix();

const BOX_EXTENSION_TO_LANGUAGE: Readonly<
  Record<string, FilesDocumentLanguage>
> = {
  cjs: "javascript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  mts: "typescript",
  ts: "typescript",
  tsx: "typescript",
  vue: "vue",
};

const EXTENSION_TO_LANGUAGE: Readonly<Record<string, FilesDocumentLanguage>> = {
  ...MATRIX_EXTENSION_TO_LANGUAGE,
  ...BOX_EXTENSION_TO_LANGUAGE,
};

const BASENAME_RULES = editorBasenameRulesFromMatrix();

function matchBasenameLanguage(
  loweredName: string
): FilesDocumentLanguage | null {
  for (const rule of BASENAME_RULES) {
    for (const matcher of rule.matchers) {
      const m = matcher.toLowerCase();
      if (m.endsWith(".*")) {
        const prefix = m.slice(0, -2);
        if (loweredName === prefix || loweredName.startsWith(`${prefix}.`)) {
          return rule.editorLanguageId as FilesDocumentLanguage;
        }
      } else if (loweredName === m) {
        return rule.editorLanguageId as FilesDocumentLanguage;
      }
    }
  }
  return null;
}

export function languageForPath(
  path: string,
  projectRootPath?: string
): FilesDocumentLanguage {
  const contentDirectories =
    liveModuleProjectContentDirectories(projectRootPath);
  if (isProjectCanvasPath(path, contentDirectories)) {
    return "canvas";
  }
  const basename = path.split("/").filter(Boolean).at(-1) ?? "";
  const lowered = basename.toLowerCase();
  const byBasename = matchBasenameLanguage(lowered);
  if (byBasename) {
    return byBasename;
  }
  const dot = lowered.lastIndexOf(".");
  if (dot < 0 || dot === lowered.length - 1) {
    const dynamicBare = editorLanguageModeRegistry.languageIdForPath(path);
    return dynamicBare ?? "text";
  }
  const ext = lowered.slice(dot + 1);
  const builtin = EXTENSION_TO_LANGUAGE[ext];
  if (builtin) {
    return builtin;
  }
  const dynamic = editorLanguageModeRegistry.languageIdForPath(path);
  return dynamic ?? "text";
}
