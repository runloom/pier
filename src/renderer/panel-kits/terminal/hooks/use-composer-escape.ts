import { useEffect } from "react";
import { activeTerminalPanelId } from "@/lib/actions/renderer-action-runtime.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { writeComposerDraft } from "../composer-helpers.ts";
import {
  acquireTerminalEscapeShortcut,
  isBareEscapeForward,
} from "../escape-shortcut.ts";
import type { StructuredComposerEditorHandle } from "../structured-composer/editor.tsx";

/**
 * Panel 级 Esc 关闭增强输入：编辑器失焦 / 终端仍占 FR 时，仅靠
 * ContentEditable onKeyDown 收不到 Esc。与搜索栏同口径：web keydown
 * capture + native forward。
 */
export function useTerminalComposerEscape(input: {
  disabled: boolean;
  editorRef: { current: StructuredComposerEditorHandle | null };
  isActive: boolean;
  onClose: () => void;
  panelId: string;
  valueRef: { current: string };
}): void {
  const { disabled, editorRef, isActive, onClose, panelId, valueRef } = input;

  useEffect(() => {
    if (disabled || !isActive) {
      return;
    }
    const releaseEscapeShortcut = acquireTerminalEscapeShortcut();

    const closeFromEscape = (): boolean => {
      if (activeTerminalPanelId() !== panelId) {
        return false;
      }
      if (useKeybindingScope.getState().overlayStack.length > 0) {
        return false;
      }
      if (editorRef.current?.isMentionMenuOpen()) {
        editorRef.current.dismissMentionMenu();
        return true;
      }
      writeComposerDraft(panelId, valueRef.current);
      onClose();
      return true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      if (event.isComposing) {
        return;
      }
      // ContentEditable 路径已由 React onKeyDown 处理；避免双关。
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[data-testid="terminal-composer-input"]')
      ) {
        return;
      }
      if (!closeFromEscape()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    const unsubscribeForward = window.pier?.keybinding?.onForward?.(
      ({ modifierFlags, chars }) => {
        if (!isBareEscapeForward(modifierFlags, chars)) {
          return;
        }
        closeFromEscape();
      }
    );

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribeForward?.();
      releaseEscapeShortcut();
    };
  }, [disabled, editorRef, isActive, onClose, panelId, valueRef]);
}
