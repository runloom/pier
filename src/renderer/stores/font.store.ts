/**
 * 字体偏好 store — 管理 UI / Mono / Document 字体族与字号偏好，
 * 字段顺序与外观设置一致：界面 → 等宽 → 文档 → 终端/代码字号。
 * 同步写入 :root CSS 变量：
 * - --pier-ui-font-family / --pier-mono-font-family / --pier-document-font-family
 * - --pier-code-font-size（文件编辑 + Git Diff；终端字号不写 CSS，走 native）
 *
 * 参考 loomdesk font.svelte.ts + font-utils.ts:
 * - 用户输入空字符串 → 走内置 fallback 链
 * - 用户输入非空 → 作为 primary 插入 fallback 链头部
 *
 * Document font: Markdown 预览正文 + docs 类画布阅读流；
 * composition / kit / 组件展台不使用（保持界面字体）。
 */
import type { DocFontMode } from "@shared/contracts/preferences.ts";
import { create } from "zustand";

// ── Fallback 链 ─────────────────────────────────────────────────────────────
const UI_FALLBACK = [
  "HarmonyOS Sans SC",
  "Apple Color Emoji",
  "Segoe UI Emoji",
  "Noto Color Emoji",
  "system-ui",
  "-apple-system",
  "Helvetica Neue",
  "PingFang SC",
  "sans-serif",
];

const MONO_FALLBACK = [
  "JetBrainsMono Nerd Font Mono",
  "ui-monospace",
  "SFMono-Regular",
  "HarmonyOS Sans SC",
  "PingFang SC",
  "Menlo",
  "monospace",
];

// 终端 (ghostty) 专用 fallback：必须是真实字体名，不能含 ui-monospace/monospace 这类 CSS generic
const MONO_TERMINAL_FALLBACK = [
  "JetBrainsMono Nerd Font Mono",
  "HarmonyOS Sans SC",
  "Menlo",
];

/** Custom document mode: serif-first reading stack (CJK + Latin). */
const DOCUMENT_FALLBACK = [
  "Noto Serif SC",
  "Noto Serif CJK SC",
  "Source Han Serif SC",
  "Songti SC",
  "STSong",
  "SimSun",
  "Noto Serif",
  "Georgia",
  "Times New Roman",
  "serif",
];

// ── 工具函数 ─────────────────────────────────────────────────────────────────

const RE_QUOTED = /^["']/;
const RE_HAS_SPACE = /\s/;
const RE_STRIP_QUOTES = /^["']|["']$/g;
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-monospace",
  "ui-sans-serif",
  "ui-serif",
  "ui-rounded",
  "-apple-system",
]);

/** 给含空格的字体名加引号 */
function quoteFontName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "";
  }
  if (RE_QUOTED.test(trimmed)) {
    return trimmed;
  }
  if (GENERIC_FAMILIES.has(trimmed)) {
    return trimmed;
  }
  return RE_HAS_SPACE.test(trimmed) ? `"${trimmed}"` : trimmed;
}

/** 解析用户逗号分隔输入为字体名数组 */
function parseUserInput(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 构建去重 font-family 字符串 */
function buildFontFamily(primary: string[], fallback: string[]): string {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of [...primary, ...fallback]) {
    const lower = name.toLowerCase().replace(/["']/g, "");
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    result.push(quoteFontName(name));
  }
  return result.filter(Boolean).join(", ");
}

/**
 * Reject CSS breakout; return trimmed user primary input or "".
 * Empty means "fallback chain only" (same as Appearance empty UI font).
 */
export function sanitizeDocFontPrimary(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim().replaceAll(/\s+/gu, " ");
  if (!trimmed) {
    return "";
  }
  if (/[;{}\\]|url\s*\(|expression\s*\(|@import|<\/?[a-z]/iu.test(trimmed)) {
    return "";
  }
  if (!/^[\w\s,"'\-.\u0080-\uFFFF]+$/u.test(trimmed)) {
    return "";
  }
  return trimmed;
}

export function computeUiFontFamily(userInput: string): string {
  return buildFontFamily(parseUserInput(userInput), UI_FALLBACK);
}

export function computeMonoFontFamily(userInput: string): string {
  return buildFontFamily(parseUserInput(userInput), MONO_FALLBACK);
}

/**
 * Resolved CSS font-family for document reading surfaces.
 * `ui` mode mirrors the interface stack; `custom` uses document serif fallbacks.
 */
export function computeDocumentFontFamily(
  mode: DocFontMode,
  uiInput: string,
  docInput: string
): string {
  if (mode !== "custom") {
    return computeUiFontFamily(uiInput);
  }
  return buildFontFamily(
    parseUserInput(sanitizeDocFontPrimary(docInput)),
    DOCUMENT_FALLBACK
  );
}

/**
 * 终端字体族列表 — 返回去重后的字体名数组 (用户字体在前 + 内置 fallback)。
 * 与 computeMonoFontFamily(CSS 串) 区别：用于 ghostty 多行 font-family，
 * 不拼逗号、不加引号、剔除 CSS generic。
 */
export function computeMonoFontFamilyList(userInput: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of [
    ...parseUserInput(userInput),
    ...MONO_TERMINAL_FALLBACK,
  ]) {
    const cleaned = name.trim().replace(RE_STRIP_QUOTES, "").trim();
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (GENERIC_FAMILIES.has(key)) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(cleaned);
  }
  return result.length > 0 ? result : ["Menlo"];
}

// ── DOM 同步 ─────────────────────────────────────────────────────────────────

function syncCssVars(
  uiInput: string,
  monoInput: string,
  docMode: DocFontMode,
  docInput: string,
  codeFontSize: number
): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.style.setProperty("--pier-ui-font-family", computeUiFontFamily(uiInput));
  root.style.setProperty(
    "--pier-mono-font-family",
    computeMonoFontFamily(monoInput)
  );
  root.style.setProperty(
    "--pier-document-font-family",
    computeDocumentFontFamily(docMode, uiInput, docInput)
  );
  root.style.setProperty("--pier-code-font-size", `${codeFontSize}px`);
}

// ── Store ────────────────────────────────────────────────────────────────────

interface FontSnapshot {
  codeFontSize: number;
  docFontFamily: string;
  docFontMode: DocFontMode;
  monoFontFamily: string;
  monoFontSize: number;
  uiFontFamily: string;
}

interface FontState extends FontSnapshot {
  _hydrate: (snapshot: FontSnapshot) => void;
  setCodeFontSize: (next: number) => Promise<void>;
  setDocFontFamily: (next: string) => Promise<void>;
  setDocFontMode: (next: DocFontMode) => Promise<void>;
  setMonoFontFamily: (next: string) => Promise<void>;
  setMonoFontSize: (next: number) => Promise<void>;
  setUiFontFamily: (next: string) => Promise<void>;
}

function normalizeDocFontMode(value: unknown): DocFontMode {
  return value === "custom" ? "custom" : "ui";
}

function toFontSnapshot(snapshot: {
  codeFontSize?: unknown;
  docFontFamily?: unknown;
  docFontMode?: unknown;
  monoFontFamily?: unknown;
  monoFontSize?: unknown;
  uiFontFamily?: unknown;
}): FontSnapshot {
  return {
    uiFontFamily:
      typeof snapshot.uiFontFamily === "string" ? snapshot.uiFontFamily : "",
    monoFontFamily:
      typeof snapshot.monoFontFamily === "string"
        ? snapshot.monoFontFamily
        : "",
    docFontMode: normalizeDocFontMode(snapshot.docFontMode),
    docFontFamily:
      typeof snapshot.docFontFamily === "string"
        ? sanitizeDocFontPrimary(snapshot.docFontFamily)
        : "",
    monoFontSize:
      typeof snapshot.monoFontSize === "number" ? snapshot.monoFontSize : 13,
    codeFontSize:
      typeof snapshot.codeFontSize === "number" ? snapshot.codeFontSize : 13,
  };
}

export const useFontStore = create<FontState>((set, get) => ({
  uiFontFamily: "",
  monoFontFamily: "",
  docFontMode: "ui",
  docFontFamily: "",
  monoFontSize: 13,
  codeFontSize: 13,

  _hydrate(snapshot) {
    const next = toFontSnapshot(snapshot);
    const current = get();
    if (
      current.uiFontFamily === next.uiFontFamily &&
      current.monoFontFamily === next.monoFontFamily &&
      current.docFontMode === next.docFontMode &&
      current.docFontFamily === next.docFontFamily &&
      current.monoFontSize === next.monoFontSize &&
      current.codeFontSize === next.codeFontSize
    ) {
      return;
    }
    syncCssVars(
      next.uiFontFamily,
      next.monoFontFamily,
      next.docFontMode,
      next.docFontFamily,
      next.codeFontSize
    );
    set(next);
  },

  async setUiFontFamily(next) {
    try {
      const merged = await window.pier.preferences.update({
        uiFontFamily: next,
      });
      useFontStore.getState()._hydrate(toFontSnapshot(merged));
    } catch (err) {
      console.error("[font.store] setUiFontFamily IPC failed:", err);
      throw err;
    }
  },

  async setMonoFontFamily(next) {
    try {
      const merged = await window.pier.preferences.update({
        monoFontFamily: next,
      });
      useFontStore.getState()._hydrate(toFontSnapshot(merged));
    } catch (err) {
      console.error("[font.store] setMonoFontFamily IPC failed:", err);
      throw err;
    }
  },

  async setDocFontMode(next) {
    try {
      const merged = await window.pier.preferences.update({
        docFontMode: next,
      });
      useFontStore.getState()._hydrate(toFontSnapshot(merged));
    } catch (err) {
      console.error("[font.store] setDocFontMode IPC failed:", err);
      throw err;
    }
  },

  async setDocFontFamily(next) {
    try {
      const merged = await window.pier.preferences.update({
        docFontFamily: sanitizeDocFontPrimary(next),
      });
      useFontStore.getState()._hydrate(toFontSnapshot(merged));
    } catch (err) {
      console.error("[font.store] setDocFontFamily IPC failed:", err);
      throw err;
    }
  },

  async setMonoFontSize(next) {
    try {
      const merged = await window.pier.preferences.update({
        monoFontSize: next,
      });
      useFontStore.getState()._hydrate(toFontSnapshot(merged));
    } catch (err) {
      console.error("[font.store] setMonoFontSize IPC failed:", err);
      throw err;
    }
  },

  async setCodeFontSize(next) {
    try {
      const merged = await window.pier.preferences.update({
        codeFontSize: next,
      });
      useFontStore.getState()._hydrate(toFontSnapshot(merged));
    } catch (err) {
      console.error("[font.store] setCodeFontSize IPC failed:", err);
      throw err;
    }
  },
}));

// ── Bootstrap ────────────────────────────────────────────────────────────────

let preferencesListenerAttached = false;
let detachPreferencesListener: (() => void) | null = null;

function attachPreferencesListener(): void {
  if (preferencesListenerAttached || typeof window === "undefined") {
    return;
  }
  const detach = window.pier?.preferences?.onChanged?.((next) => {
    useFontStore.getState()._hydrate(toFontSnapshot(next));
  });
  if (!detach) {
    return;
  }
  detachPreferencesListener = detach;
  preferencesListenerAttached = true;
}

export function detachFontListener(): void {
  detachPreferencesListener?.();
  detachPreferencesListener = null;
  preferencesListenerAttached = false;
}

export async function initFont(): Promise<void> {
  // Attach before read so multi-window pier:preferences:changed is not dropped
  // during the first await (same ordering as theme/zoom stores).
  attachPreferencesListener();
  try {
    const snapshot = await window.pier.preferences.read();
    useFontStore.getState()._hydrate(toFontSnapshot(snapshot));
  } catch (err) {
    console.error("[font.store] initFont IPC failed; keeping defaults:", err);
  }
}
