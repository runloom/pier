import type { FilesDocumentLanguage } from "./files-document-types.ts";

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
  cs: "cpp",
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
  mjs: "javascript",
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
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

export function languageForPath(path: string): FilesDocumentLanguage {
  const basename = path.split("/").filter(Boolean).at(-1) ?? "";
  const lowered = basename.toLowerCase();
  const dot = lowered.lastIndexOf(".");
  if (dot < 0 || dot === lowered.length - 1) {
    return "text";
  }
  const ext = lowered.slice(dot + 1);
  return EXTENSION_TO_LANGUAGE[ext] ?? "text";
}
