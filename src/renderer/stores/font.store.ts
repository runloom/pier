/**
 * 字体偏好 store — 管理 UI / Mono 字体族自定义值，
 * 同步写入 :root CSS 变量 (--pier-ui-font-family / --pier-mono-font-family)。
 *
 * 参考 loomdesk font.svelte.ts + font-utils.ts:
 * - 用户输入空字符串 → 走内置 fallback 链
 * - 用户输入非空 → 作为 primary 插入 fallback 链头部
 */
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
  "JetBrains Mono",
  "Menlo",
  "monospace",
];

// 终端 (ghostty) 专用 fallback：必须是真实字体名，不能含 ui-monospace/monospace 这类 CSS generic
const MONO_TERMINAL_FALLBACK = [
  "JetBrainsMono Nerd Font Mono",
  "HarmonyOS Sans SC",
  "Menlo",
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

export function computeUiFontFamily(userInput: string): string {
  return buildFontFamily(parseUserInput(userInput), UI_FALLBACK);
}

export function computeMonoFontFamily(userInput: string): string {
  return buildFontFamily(parseUserInput(userInput), MONO_FALLBACK);
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

function syncCssVars(uiInput: string, monoInput: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.style.setProperty("--pier-ui-font-family", computeUiFontFamily(uiInput));
  root.style.setProperty(
    "--pier-mono-font-family",
    computeMonoFontFamily(monoInput)
  );
}

// ── Store ────────────────────────────────────────────────────────────────────

interface FontState {
  _hydrate: (snapshot: {
    uiFontFamily: string;
    monoFontFamily: string;
    monoFontSize: number;
  }) => void;
  monoFontFamily: string;
  monoFontSize: number;
  setMonoFontFamily: (next: string) => Promise<void>;
  setMonoFontSize: (next: number) => Promise<void>;
  setUiFontFamily: (next: string) => Promise<void>;
  uiFontFamily: string;
}

export const useFontStore = create<FontState>((set) => ({
  uiFontFamily: "",
  monoFontFamily: "",
  monoFontSize: 13,

  _hydrate({ uiFontFamily, monoFontFamily, monoFontSize }) {
    syncCssVars(uiFontFamily, monoFontFamily);
    set({ uiFontFamily, monoFontFamily, monoFontSize });
  },

  async setUiFontFamily(next) {
    try {
      const merged = await window.pier.preferences.update({
        uiFontFamily: next,
      });
      const value = (merged.uiFontFamily as string) ?? "";
      syncCssVars(value, useFontStore.getState().monoFontFamily);
      set({ uiFontFamily: value });
    } catch (err) {
      console.error("[font.store] setUiFontFamily IPC failed:", err);
    }
  },

  async setMonoFontFamily(next) {
    try {
      const merged = await window.pier.preferences.update({
        monoFontFamily: next,
      });
      const value = (merged.monoFontFamily as string) ?? "";
      syncCssVars(useFontStore.getState().uiFontFamily, value);
      set({ monoFontFamily: value });
    } catch (err) {
      console.error("[font.store] setMonoFontFamily IPC failed:", err);
    }
  },

  async setMonoFontSize(next) {
    try {
      const merged = await window.pier.preferences.update({
        monoFontSize: next,
      });
      const value = (merged.monoFontSize as number) ?? 13;
      set({ monoFontSize: value });
    } catch (err) {
      console.error("[font.store] setMonoFontSize IPC failed:", err);
    }
  },
}));

// ── Bootstrap ────────────────────────────────────────────────────────────────

export async function initFont(): Promise<void> {
  try {
    const snapshot = await window.pier.preferences.read();
    useFontStore.getState()._hydrate({
      uiFontFamily: (snapshot.uiFontFamily as string) ?? "",
      monoFontFamily: (snapshot.monoFontFamily as string) ?? "",
      monoFontSize: (snapshot.monoFontSize as number) ?? 13,
    });
  } catch (err) {
    console.error("[font.store] initFont IPC failed; keeping defaults:", err);
  }
}
