import type {
  ResolvedTheme,
  StylePresetId,
  ThemePreference,
} from "@shared/contracts/preferences.ts";

import { create } from "zustand";
import { applyTokens } from "@/lib/theme/apply-tokens.ts";
import { deriveTerminalColors } from "@/lib/theme/derive-terminal-colors.ts";
import {
  getShikiTheme,
  STYLE_PRESET_REGISTRY,
} from "@/lib/theme/preset-registry.ts";
import { syncThemeHead } from "@/lib/theme/sync-head.ts";

interface ThemeState {
  _hydrate: (snapshot: {
    theme: ThemePreference;
    stylePresetId: StylePresetId;
  }) => void;
  resolvedTheme: ResolvedTheme;
  setStylePreset: (next: StylePresetId) => Promise<void>;
  setTheme: (next: ThemePreference) => Promise<void>;
  stylePresetId: StylePresetId;
  theme: ThemePreference;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "light" || preference === "dark") {
    return preference;
  }
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
  return prefersDark ? "dark" : "light";
}

/** 从 applyTokens 写入的 inline style 读取 --muted (sidebar/tab-bar 底色). */
function readChromeColor(): string | undefined {
  if (typeof document === "undefined") {
    return;
  }
  const val = document.documentElement.style.getPropertyValue("--muted").trim();
  return val || undefined;
}

function applyDocumentTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.classList.toggle("light", resolved === "light");
  root.classList.toggle("dark", resolved === "dark");
  syncThemeHead({ resolved });
  window.pier?.theme
    ?.setNativeChrome?.(resolved, readChromeColor())
    ?.catch(() => undefined);
}

/**
 * 把当前 preset + 模式派生的终端配色推给 native Ghostty controller.
 * 在所有主题变化点调一次: _hydrate / setTheme / setStylePreset / system listener
 * / preferences listener (跨窗口同步) / applyThemeVisual (命令面板 hover 预览).
 *
 * 用 requestAnimationFrame coalesce — 同一帧内多次调用合并成一次 IPC, 避免
 * 命令面板箭头狂按时引起 controller.setTheme 风暴 (每次 setTheme 会写 ghostty
 * 临时 .conf + 遍历所有 surface reconfigure). 用户连续切预览时, 最多每帧一次
 * IPC, 视觉跟随且 native 端不被打爆. accept 类 setter 同帧内调一次 applyTokens
 * + applyTerminalColors, 下一帧 flush 时拿到最终色板; dismiss 时同样调一次
 * applyThemeVisual(original) 即可还原, rAF 自然合并到一个 IPC.
 *
 * 失败 (preload 未 ready / native addon 未装) 时静默 — 终端只是色板没跟上, 不
 * 影响 DOM 主题应用; 不能让 IPC 错误拖垮整个主题切换.
 */
let pendingTerminalApply: {
  presetId: StylePresetId;
  resolved: ResolvedTheme;
} | null = null;
let scheduledTerminalFrame: number | null = null;

function flushPendingTerminalApply(): void {
  scheduledTerminalFrame = null;
  const pending = pendingTerminalApply;
  pendingTerminalApply = null;
  if (!pending) {
    return;
  }
  try {
    const shiki = getShikiTheme(pending.presetId, pending.resolved);
    const colors = deriveTerminalColors(shiki, pending.resolved);
    window.pier?.terminal?.applyTheme?.(colors);
  } catch (err) {
    console.error("[theme.store] applyTerminalColors failed:", err);
  }
}

function applyTerminalColors(
  presetId: StylePresetId,
  resolved: ResolvedTheme
): void {
  pendingTerminalApply = { presetId, resolved };
  if (scheduledTerminalFrame !== null) {
    return;
  }
  if (typeof window === "undefined" || !window.requestAnimationFrame) {
    flushPendingTerminalApply();
    return;
  }
  scheduledTerminalFrame = window.requestAnimationFrame(
    flushPendingTerminalApply
  );
}

export function applyThemeVisual(
  themePreference: ThemePreference,
  presetId: StylePresetId
): void {
  const resolved = resolveTheme(themePreference);
  applyTokens({ presetId, resolved });
  applyDocumentTheme(resolved);
  applyTerminalColors(presetId, resolved);
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: "system",
  resolvedTheme: "dark",
  stylePresetId: "pierre",

  _hydrate({ theme, stylePresetId }) {
    const resolved = resolveTheme(theme);
    applyTokens({ presetId: stylePresetId, resolved });
    applyDocumentTheme(resolved);
    applyTerminalColors(stylePresetId, resolved);
    set({ theme, resolvedTheme: resolved, stylePresetId });
  },

  async setTheme(next) {
    try {
      const merged = await window.pier.preferences.update({ theme: next });
      const resolved = resolveTheme(merged.theme as ThemePreference);
      const currentPreset = useThemeStore.getState().stylePresetId;
      applyTokens({ presetId: currentPreset as StylePresetId, resolved });
      applyDocumentTheme(resolved);
      applyTerminalColors(currentPreset as StylePresetId, resolved);
      set({
        theme: merged.theme as ThemePreference,
        resolvedTheme: resolved,
      });
    } catch (err) {
      console.error("[theme.store] setTheme IPC failed:", err);
    }
  },

  async setStylePreset(next) {
    // 纯校验, 不写 DOM — 防止 stale settings UI 把已删除的 preset id 写到 disk
    // 引起下次启动 _hydrate 抛错. 与"applyTokens 提前到 update 之前"的旧路径
    // 不同, 这里 update 失败时 DOM 完全不动, 三态 (DOM / store / disk) 始终一致.
    if (!(next in STYLE_PRESET_REGISTRY)) {
      console.error(
        `[theme.store] setStylePreset: unknown preset id "${next}"`
      );
      return;
    }
    try {
      const merged = await window.pier.preferences.update({
        stylePresetId: next,
      });
      const nextPreset = merged.stylePresetId as StylePresetId;
      const currentResolved = useThemeStore.getState().resolvedTheme;
      applyTokens({ presetId: nextPreset, resolved: currentResolved });
      syncThemeHead({ resolved: currentResolved });
      window.pier?.theme
        ?.setNativeChrome?.(currentResolved, readChromeColor())
        ?.catch(() => undefined);
      applyTerminalColors(nextPreset, currentResolved);
      set({
        stylePresetId: nextPreset,
      });
    } catch (err) {
      console.error("[theme.store] setStylePreset failed:", err);
    }
  },
}));

let systemListenerAttached = false;
let detachSystemListener: (() => void) | null = null;
let preferencesListenerAttached = false;
let detachPreferencesListener: (() => void) | null = null;

/**
 * 订阅 main 端广播的 preferences 变化 — 其他窗口修改 theme / stylePreset 时,
 * 本窗口收到后同步 DOM + 终端配色 + store state. main 端已经把 sender 自己排除,
 * 所以这里不会收到自己窗口刚 await 完的回声.
 */
function attachPreferencesListener(): void {
  if (preferencesListenerAttached || typeof window === "undefined") {
    return;
  }
  const detach = window.pier?.preferences?.onChanged?.((next) => {
    const nextTheme = next.theme as ThemePreference;
    const nextPreset = next.stylePresetId as StylePresetId;
    const current = useThemeStore.getState();
    if (current.theme === nextTheme && current.stylePresetId === nextPreset) {
      return;
    }
    const resolved = resolveTheme(nextTheme);
    applyTokens({ presetId: nextPreset, resolved });
    applyDocumentTheme(resolved);
    applyTerminalColors(nextPreset, resolved);
    useThemeStore.setState({
      resolvedTheme: resolved,
      stylePresetId: nextPreset,
      theme: nextTheme,
    });
  });
  if (!detach) {
    return;
  }
  detachPreferencesListener = detach;
  preferencesListenerAttached = true;
}

function attachSystemListener(): void {
  if (systemListenerAttached || typeof window === "undefined") {
    return;
  }
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!mq) {
    return;
  }
  const onChange = (): void => {
    if (useThemeStore.getState().theme !== "system") {
      return;
    }
    const resolved = resolveTheme("system");
    const { stylePresetId } = useThemeStore.getState();
    applyTokens({ presetId: stylePresetId, resolved });
    applyDocumentTheme(resolved);
    applyTerminalColors(stylePresetId, resolved);
    useThemeStore.setState({ resolvedTheme: resolved });
  };
  mq.addEventListener("change", onChange);
  detachSystemListener = () => mq.removeEventListener("change", onChange);
  systemListenerAttached = true;
}

export function detachThemeSystemListener(): void {
  detachSystemListener?.();
  detachSystemListener = null;
  systemListenerAttached = false;
  detachPreferencesListener?.();
  detachPreferencesListener = null;
  preferencesListenerAttached = false;
}

export async function initTheme(): Promise<void> {
  // 先 attach listener 再 await read — 防止新窗口在 read 进行中错过其它窗口的
  // pier:preferences:changed 广播 (preload 已收到事件但 JS listener 还没装,
  // 事件被 dropped, 后续也没有 catch-up 路径). listener 比 read 早 fire 不会
  // 出问题: broadcast 携带的是最新 disk 内容, 它先应用, 之后 _hydrate 应用
  // read snapshot 是相同或更旧值; 若旧值, 下次 broadcast 会再覆盖到一致.
  attachSystemListener();
  attachPreferencesListener();
  try {
    const snapshot = await window.pier.preferences.read();
    useThemeStore.getState()._hydrate({
      theme: snapshot.theme as ThemePreference,
      stylePresetId: snapshot.stylePresetId as StylePresetId,
    });
  } catch (err) {
    console.error(
      "[theme.store] initTheme IPC failed; falling back to defaults:",
      err
    );
    const current = useThemeStore.getState();
    current._hydrate({
      theme: current.theme,
      stylePresetId: current.stylePresetId,
    });
  }
}
