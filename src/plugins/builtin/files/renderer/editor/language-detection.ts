import {
  isProjectCanvasPath,
  liveModuleProjectContentDirectories,
} from "@shared/live-module-canvas-path.ts";
import type { FilesDocumentLanguage } from "../document/types.ts";
import { editorLanguageModeRegistry } from "./language-mode-registry.ts";

// Cursor 参考:文件面板顶部的语言标签 + syntax highlight 依赖此推断。扩展名到
// language id 的映射保持保守 —— 只映射存在 codemirror 语言支持或 legacy-modes
// 覆盖的文件类型;未识别时回落 "text",走 basicSetup 默认高亮,不阻断编辑。
const EXTENSION_TO_LANGUAGE: Readonly<Record<string, FilesDocumentLanguage>> = {
  bash: "shell",
  c: "cpp",
  cc: "cpp",
  cjs: "javascript",
  cmd: "shell",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  fish: "shell",
  go: "go",
  h: "cpp",
  hpp: "cpp",
  htm: "html",
  html: "html",
  hxx: "cpp",
  java: "java",
  js: "javascript",
  json: "json",
  json5: "json",
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  markdown: "markdown",
  md: "markdown",
  mdx: "markdown",
  /** Objective-C — C-like highlight (same track as C/C++). */
  m: "cpp",
  mjs: "javascript",
  /** Objective-C++ (e.g. native/src/addon.mm). */
  mm: "cpp",
  mts: "typescript",
  ps1: "shell",
  py: "python",
  pyi: "python",
  pyw: "python",
  rb: "ruby",
  rs: "rust",
  scss: "css",
  sh: "shell",
  sql: "sql",
  svelte: "svelte",
  svg: "svg",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

export function languageForPath(
  path: string,
  projectRootPath?: string
): FilesDocumentLanguage {
  // Live Modules: require canvas under known project content directories
  // with a compound canvas suffix. Bare `*.tsx` outside those trees stay TS.
  const contentDirectories =
    liveModuleProjectContentDirectories(projectRootPath);
  if (isProjectCanvasPath(path, contentDirectories)) {
    return "canvas";
  }
  const basename = path.split("/").filter(Boolean).at(-1) ?? "";
  const lowered = basename.toLowerCase();
  const dot = lowered.lastIndexOf(".");
  if (dot < 0 || dot === lowered.length - 1) {
    return "text";
  }
  const ext = lowered.slice(dot + 1);
  const builtin = EXTENSION_TO_LANGUAGE[ext];
  if (builtin) {
    return builtin;
  }
  // Plugin / L1 language modes (display track). L0 map always wins first.
  const dynamic = editorLanguageModeRegistry.languageIdForPath(path);
  return dynamic ?? "text";
}
