/**
 * 全局快捷键 dispatch hook: capture-phase keydown → resolve → action.handler().
 *
 *   - IME composition 跳过 (e.isComposing / keyCode 229).
 *   - 文本输入框聚焦时:
 *       · 无 Cmd/Ctrl 的快捷键不抢字符输入
 *       · Enter 系和弦留给输入框 (换行 / 提交)；布局类如 maximize(⌘⇧M) 仍可触发
 *   - 命中后 preventDefault + stopPropagation.
 *   - action.handler 抛错走 console.error 留痕, 不静默 swallow.
 *
 * 双路径监听:
 *   1. window keydown (capture): web 层正常 keyboard 路径 — 当 firstResponder
 *      是 WKWebView 时直接命中 (打开 command-palette / 输入框输入等场景).
 *   2. IPC 'pier:keybinding:forward': 当 terminal NSView 占 firstResponder, web
 *      永远收不到 keydown — swift NSEvent monitor 拦截 Cmd+key 转 main 转 renderer,
 *      经此路径走相同的 action dispatch.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { activeTerminalPanelId } from "@/lib/actions/renderer-action-runtime.ts";
import type { Action } from "@/lib/actions/types.ts";
import { recordTerminalInputRoutingTrace } from "@/lib/terminal-debug/input-routing-trace.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";
import { isTerminalComposerOpen } from "@/stores/terminal-composer-takeover.ts";
import { chordFromEvent } from "./matcher.ts";
import { keybindingRegistry } from "./registry.ts";
import { shouldSuppressKeybindingForTextInput } from "./text-input-guard.ts";
import type { KeyChord } from "./types.ts";

const IME_PENDING_KEYCODE = 229;

export type KeybindingDispatchRoute = "native-forward" | "web-keydown";

// NSEvent.ModifierFlags raw bits (deviceIndependentFlagsMask 子集).
const NS_FLAG_SHIFT = 0x2_00_00;
const NS_FLAG_CONTROL = 0x4_00_00;
const NS_FLAG_OPTION = 0x8_00_00;
const NS_FLAG_COMMAND = 0x10_00_00;

// charsToCode 用 — top-level regex 避免每次 keydown re-compile.
const LATIN_LOWER_RE = /^[a-z]$/;
const DIGIT_RE = /^[0-9]$/;

function isImePending(e: KeyboardEvent): boolean {
  return e.isComposing === true || e.keyCode === IME_PENDING_KEYCODE;
}

function isNewAgentOrAttachChord(chord: KeyChord): boolean {
  return (
    chord.cmdOrCtrl &&
    chord.shift &&
    !chord.alt &&
    !chord.ctrl &&
    chord.code === "KeyA"
  );
}

function isComposerAttachContext(panelId: string): boolean {
  // Only steal ⌘⇧A while Rich Input is mounted AND keyboard-focused.
  // Mounted-but-blurred (e.g. typing in the terminal) keeps "new agent".
  if (!isTerminalComposerOpen(panelId)) {
    return false;
  }
  return (
    useTerminalStore.getState().activeOverlayId ===
    `terminal-composer:${panelId}`
  );
}

function recordKeybindingDecision(
  action:
    | "disabled"
    | "handler-rejected"
    | "missing-action"
    | "overlay-blocked"
    | "text-input-suppressed"
    | "dispatched",
  commandId: string,
  route: KeybindingDispatchRoute
): void {
  const scope = useKeybindingScope.getState();
  recordTerminalInputRoutingTrace({
    action,
    ...(scope.activePanelComponent
      ? { activePanelComponent: scope.activePanelComponent.slice(0, 80) }
      : {}),
    commandId: commandId.slice(0, 160),
    overlayCount: Math.min(scope.overlayStack.length, 32),
    route,
    source: "keybinding",
  });
}

export function resolveKeybindingAction(
  chord: KeyChord,
  target: EventTarget | null,
  route: KeybindingDispatchRoute
): Action | null {
  const scope = useKeybindingScope.getState();
  let commandId = keybindingRegistry.resolve(chord, {
    activePanelComponent: scope.activePanelComponent,
    overlayStack: scope.overlayStack,
  });
  if (!commandId && scope.overlayStack.length > 0) {
    const unblockedCommandId = keybindingRegistry.resolve(chord, {
      activePanelComponent: scope.activePanelComponent,
      overlayStack: [],
    });
    if (unblockedCommandId) {
      // overlay 内输入框敲键仍属文本抑制，不要记成 overlay-blocked。
      recordKeybindingDecision(
        shouldSuppressKeybindingForTextInput(chord, target)
          ? "text-input-suppressed"
          : "overlay-blocked",
        unblockedCommandId,
        route
      );
    }
    return null;
  }
  // Shared ⌘⇧A: registry may hit either binding. Prefer attach only while
  // Rich Input is focused; otherwise always new agent.
  if (
    isNewAgentOrAttachChord(chord) &&
    (commandId === "pier.terminal.composerAttach" ||
      commandId === "pier.agent.new")
  ) {
    const panelId = activeTerminalPanelId();
    commandId =
      panelId && isComposerAttachContext(panelId)
        ? "pier.terminal.composerAttach"
        : "pier.agent.new";
  }
  if (!commandId) {
    return null;
  }
  if (shouldSuppressKeybindingForTextInput(chord, target)) {
    recordKeybindingDecision("text-input-suppressed", commandId, route);
    return null;
  }
  const action = actionRegistry.get(commandId);
  if (!action) {
    recordKeybindingDecision("missing-action", commandId, route);
    return null;
  }
  // 路径依赖等动作在菜单里禁用；快捷键仍命中并 toast 原因，避免静默无响应。
  if (action.enabled?.() === false) {
    recordKeybindingDecision("disabled", action.id, route);
    const reason = action.disabledReason?.();
    if (reason) {
      toast(reason);
    }
    return null;
  }
  return action;
}

export function dispatchKeybindingAction(
  action: Action,
  route: KeybindingDispatchRoute
): void {
  recordKeybindingDecision("dispatched", action.id, route);
  try {
    const result = action.handler();
    if (result instanceof Promise) {
      result.catch((err) => {
        recordKeybindingDecision("handler-rejected", action.id, route);
        console.error(`[keybindings] action ${action.id} rejected:`, err);
      });
    }
  } catch (err) {
    recordKeybindingDecision("handler-rejected", action.id, route);
    console.error(`[keybindings] action ${action.id} threw:`, err);
  }
}

/**
 * 把 swift forward 来的 chars 转成 KeyboardEvent.code 格式 (与 default keymap
 * 一致 — keymap 用 "KeyT" / "Backquote" / "Digit1" / "ArrowUp" 等).
 *
 * Pier 当前默认 keymap 涉及的字符: t/w/n/p/r/`/,. + Enter + 方向键. 其他不在 keymap 的
 * chord 即使命中也 resolve 不到 action, 不需要在这里穷举所有可能符号.
 *
 * 方向键: macOS charactersIgnoringModifiers 在按方向键时返回 NSUpArrowFunctionKey
 * (\u{F700}) 等私有 Unicode, 必须映射到 "ArrowUp"/"ArrowDown"/"ArrowLeft"/"ArrowRight"
 * 才能跟 web 层 KeyboardEvent.code 命名空间对齐.
 */
function charsToCode(chars: string): string {
  const ch = chars.toLowerCase();
  if (LATIN_LOWER_RE.test(ch)) {
    return `Key${ch.toUpperCase()}`;
  }
  if (DIGIT_RE.test(ch)) {
    return `Digit${ch}`;
  }
  switch (ch) {
    case "`":
      return "Backquote";
    case ",":
      return "Comma";
    case ".":
      return "Period";
    case "/":
      return "Slash";
    case ";":
      return "Semicolon";
    case "'":
      return "Quote";
    case "[":
      return "BracketLeft";
    case "]":
      return "BracketRight";
    case "\\":
      return "Backslash";
    case "-":
      return "Minus";
    case "=":
      return "Equal";
    case "\r":
      return "Enter";
    case "\u{3}":
      return "Enter";
    case "\u{F700}":
      return "ArrowUp";
    case "\u{F701}":
      return "ArrowDown";
    case "\u{F702}":
      return "ArrowLeft";
    case "\u{F703}":
      return "ArrowRight";
    case "\u{1b}":
      return "Escape";
    default:
      return ch; // fallback: 让 keymap resolve 自行不命中
  }
}

function hasFlag(modifierFlags: number, flag: number): boolean {
  // biome-ignore lint/suspicious/noBitwiseOperators: NSEvent.modifierFlags 是位掩码 — bitwise AND 是标准 flag check, 不是 typo
  return (modifierFlags & flag) !== 0;
}

function chordFromNativeForward(
  modifierFlags: number,
  chars: string
): KeyChord {
  const hasCmd = hasFlag(modifierFlags, NS_FLAG_COMMAND);
  const hasCtrl = hasFlag(modifierFlags, NS_FLAG_CONTROL);
  // 路径 2 仅在 mac 上跑 (NS_FLAG_* 是 mac 概念). mac 上 Mod = Cmd, ctrl 字段
  // 独立表达 Ctrl 物理键. 同时按 Cmd+Ctrl 时 ctrl 仍真; chordEquals 严格匹配
  // 决定 resolve 结果.
  return {
    cmdOrCtrl: hasCmd,
    ctrl: hasCtrl,
    alt: hasFlag(modifierFlags, NS_FLAG_OPTION),
    shift: hasFlag(modifierFlags, NS_FLAG_SHIFT),
    code: charsToCode(chars),
  };
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    // 路径 1: web 层 native keydown (firstResponder 在 WKWebView 时)
    const onKeydown = (e: KeyboardEvent) => {
      if (isImePending(e)) {
        return;
      }
      const action = resolveKeybindingAction(
        chordFromEvent(e),
        e.target,
        "web-keydown"
      );
      if (!action) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      dispatchKeybindingAction(action, "web-keydown");
    };
    window.addEventListener("keydown", onKeydown, true);

    // 路径 2: swift IPC forward (terminal NSView 占 firstResponder 时)
    const unsubscribeForward = window.pier?.keybinding?.onForward?.(
      ({ modifierFlags, chars }) => {
        const chord = chordFromNativeForward(modifierFlags, chars);
        // 此路径下没有真实 DOM target — 传 null, resolveKeybindingAction 中"输入框聚焦
        // 时跳过纯字母快捷键"的判断不会误命中 (chord 含 Cmd).
        const action = resolveKeybindingAction(chord, null, "native-forward");
        if (action) {
          dispatchKeybindingAction(action, "native-forward");
        }
      }
    );

    return () => {
      window.removeEventListener("keydown", onKeydown, true);
      unsubscribeForward?.();
    };
  }, []);
}
