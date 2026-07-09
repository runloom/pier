import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import { filesSyntaxHighlightStyle } from "@plugins/builtin/files/renderer/cm-highlight-style.ts";
import {
  cmLanguageExtension,
  LANGUAGE_LABELS,
} from "@plugins/builtin/files/renderer/cm-language.ts";
import type { FilesDocumentLanguage } from "@plugins/builtin/files/renderer/files-document-types.ts";
import { describe, expect, it } from "vitest";

// LanguageSupport / StreamLanguage 是 CodeMirror 里两种 language extension 的
// 具体 wrapper 类;`cmLanguageExtension` 的返回值必须是其中之一(或 null)。用
// class instance check 而不是查 `.language` 字段,更贴近 CodeMirror 内部约定。
function isLanguageExtension(value: unknown): boolean {
  return value instanceof LanguageSupport || value instanceof StreamLanguage;
}

const ALL_LANGUAGE_IDS = [
  "cpp",
  "css",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "markdown",
  "python",
  "ruby",
  "rust",
  "shell",
  "sql",
  "swift",
  "toml",
  "typescript",
  "xml",
  "yaml",
] as const satisfies readonly Exclude<FilesDocumentLanguage, "text">[];

describe("cmLanguageExtension", () => {
  it("returns a CodeMirror language extension for every supported language id", () => {
    for (const id of ALL_LANGUAGE_IDS) {
      const extension = cmLanguageExtension(id);
      expect(
        isLanguageExtension(extension),
        `expected language extension for ${id}`
      ).toBe(true);
    }
  });

  it("returns null for the text fallback so basicSetup keeps a plain editor", () => {
    expect(cmLanguageExtension("text")).toBeNull();
  });

  it("routes tsx / jsx to the JSX-enabled JavaScript parser via the file path hint", () => {
    // tsx / jsx 依 filePath 判断,与 cm-language 内 switch 分支保持一致。
    const tsx = cmLanguageExtension("typescript", "components/Button.tsx");
    const ts = cmLanguageExtension("typescript", "src/index.ts");
    const jsx = cmLanguageExtension("javascript", "components/Button.jsx");
    expect(tsx).toBeInstanceOf(LanguageSupport);
    expect(ts).toBeInstanceOf(LanguageSupport);
    expect(jsx).toBeInstanceOf(LanguageSupport);
    // 不同 filePath 应产生不同 extension instance(不同 flag 组合),保证
    // switch 里 typescript+jsx 与 typescript(纯) 不共享 memoized instance。
    expect(tsx).not.toBe(ts);
  });

  it("switches between clike C and lang-cpp based on the .c/.h extension", () => {
    // 都属于 language="cpp",但 .c/.h 走 legacy clike C mode,其他走 lang-cpp。
    const cSource = cmLanguageExtension("cpp", "src/main.c");
    const cppSource = cmLanguageExtension("cpp", "src/main.cpp");
    expect(cSource).toBeInstanceOf(StreamLanguage);
    expect(cppSource).toBeInstanceOf(LanguageSupport);
  });
});

describe("LANGUAGE_LABELS", () => {
  it("provides a display label for every FilesDocumentLanguage", () => {
    const allLanguageIds = [
      ...ALL_LANGUAGE_IDS,
      "text",
    ] satisfies readonly FilesDocumentLanguage[];
    for (const id of allLanguageIds) {
      expect(LANGUAGE_LABELS[id]).toBeTypeOf("string");
      expect(LANGUAGE_LABELS[id].length).toBeGreaterThan(0);
    }
  });
});

describe("filesSyntaxHighlightStyle", () => {
  it("registers highlight rules for common tokens without throwing", () => {
    // HighlightStyle.define 内部会预处理 rules 到 selector map;这里主要是
    // smoke test:确保 palette 里所有 CSS var 引用能构造完成,`module` 属性
    // 满足 codemirror 期望(有 `extension` 数组)。
    const module = filesSyntaxHighlightStyle.module;
    expect(module).toBeDefined();
    expect(module?.getRules().length).toBeGreaterThan(0);
  });
});
