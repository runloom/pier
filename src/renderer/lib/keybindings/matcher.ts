/**
 * 平台检测 + KeyboardEvent → KeyChord 归一化.
 *
 * 平台检测优先用 Electron preload 暴露的 window.pier.platform; 仅当 preload
 * 不可用 (浏览器预览 / 测试沙箱) 才回退到 navigator.platform 字符串嗅探.
 */
import type { KeyChord } from "./types.ts";

const MAC_NAV_PLATFORM_RE = /Mac|iPhone|iPad/;

function detectMac(): boolean {
  const pierPlatform =
    typeof window === "undefined" ? undefined : window.pier?.platform;
  if (pierPlatform != null) {
    return pierPlatform === "darwin";
  }
  return (
    typeof navigator !== "undefined" &&
    MAC_NAV_PLATFORM_RE.test(navigator.platform)
  );
}

const IS_MAC = detectMac();

function normalizeEventCode(code: string): string {
  return code === "NumpadEnter" ? "Enter" : code;
}

export function isMac(): boolean {
  return IS_MAC;
}

export function chordFromEvent(e: KeyboardEvent): KeyChord {
  return {
    cmdOrCtrl: IS_MAC ? e.metaKey : e.ctrlKey,
    // mac 上 Ctrl 物理键独立; 非 mac 上 Ctrl == Mod, 此字段永远 false (避免与
    // cmdOrCtrl 重复表达).
    ctrl: IS_MAC ? e.ctrlKey : false,
    alt: e.altKey,
    shift: e.shiftKey,
    code: normalizeEventCode(e.code),
  };
}

export function chordEquals(a: KeyChord, b: KeyChord): boolean {
  return (
    a.cmdOrCtrl === b.cmdOrCtrl &&
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.code === b.code
  );
}
