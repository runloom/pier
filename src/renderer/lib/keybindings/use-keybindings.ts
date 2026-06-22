/**
 * 全局快捷键 dispatch hook: capture-phase keydown → resolve → action.handler().
 *
 *   - IME composition 跳过 (e.isComposing / keyCode 229).
 *   - 文本输入框聚焦时, 无 Cmd/Ctrl 的纯字母快捷键不抢焦点输入.
 *   - 命中后 preventDefault + stopPropagation.
 *   - action.handler 抛错走 console.error 留痕, 不静默 swallow.
 */
import { useEffect } from "react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import { isTextInputElement } from "./is-text-input.ts";
import { chordFromEvent } from "./matcher.ts";
import { keybindingRegistry } from "./registry.ts";
import type { KeyChord } from "./types.ts";

const IME_PENDING_KEYCODE = 229;

function isImePending(e: KeyboardEvent): boolean {
  return e.isComposing === true || e.keyCode === IME_PENDING_KEYCODE;
}

function pickAction(
  chord: KeyChord,
  target: EventTarget | null
): Action | null {
  const commandId = keybindingRegistry.resolve(chord);
  if (!commandId) {
    return null;
  }
  if (!chord.cmdOrCtrl && isTextInputElement(target)) {
    return null;
  }
  const action = actionRegistry.get(commandId);
  if (!action || action.enabled?.() === false) {
    return null;
  }
  return action;
}

function runAction(action: Action): void {
  try {
    const result = action.handler();
    if (result instanceof Promise) {
      result.catch((err) => {
        console.error(`[keybindings] action ${action.id} rejected:`, err);
      });
    }
  } catch (err) {
    console.error(`[keybindings] action ${action.id} threw:`, err);
  }
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (isImePending(e)) {
        return;
      }
      console.log(
        "[kb] key:",
        e.code,
        "meta:",
        e.metaKey,
        "shift:",
        e.shiftKey
      );
      const action = pickAction(chordFromEvent(e), e.target);
      if (!action) {
        return;
      }
      console.log("[kb] dispatch:", action.id);
      e.preventDefault();
      e.stopPropagation();
      runAction(action);
    };
    window.addEventListener("keydown", onKeydown, true);
    return () => {
      window.removeEventListener("keydown", onKeydown, true);
    };
  }, []);
}
