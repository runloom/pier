import { useTerminalOverlayRegistration } from "@pier/ui/use-terminal-overlay.tsx";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import {
  useTerminalOverlayFocus,
  useTerminalStore,
} from "@/stores/terminal.store.ts";
import { registerTerminalComposerTakeover } from "@/stores/terminal-composer-takeover.ts";
import {
  clearComposerDraft,
  focusComposerInput,
  readComposerDraft,
  reportComposerSendFailure,
  textareaSoftWrapped,
  writeComposerDraft,
} from "./terminal-composer-helpers.ts";
import { passthroughKeyPressForKey } from "./terminal-composer-passthrough.ts";
import { TerminalComposerView } from "./terminal-composer-view.tsx";
import { useTerminalComposerAttachments } from "./use-terminal-composer-attachments.ts";

export {
  resetTerminalComposerDraftsForTests,
  TERMINAL_COMPOSER_GAP_PX,
  TERMINAL_COMPOSER_RESERVE_HEIGHT_PX,
} from "./terminal-composer-helpers.ts";

interface TerminalComposerProps {
  bottomOffsetPx: number;
  disabled: boolean;
  /** Bumped when Rich Input opens so the textarea receives focus. */
  focusRequest?: number;
  /** 面板是否为当前激活 tab；切回时补聚焦。 */
  isActive: boolean;
  /** Panel-owned close: Esc / send success. Terminal surface click does NOT close. */
  onClose: () => void;
  onHeightChange: (heightPx: number) => void;
  panelId: string;
}

export function TerminalComposer({
  bottomOffsetPx,
  disabled,
  focusRequest = 0,
  isActive,
  onClose,
  onHeightChange,
  panelId,
}: TerminalComposerProps) {
  const t = useT();
  const overlayId = `terminal-composer:${panelId}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => readComposerDraft(panelId));
  // Soft-wrap line count (not raw height) drives compact→expanded with hard \n / attachments.
  const [softWrapped, setSoftWrapped] = useState(false);
  // Sticky expanded: once multiline/attached, stay expanded until draft empty.
  const [stickyExpanded, setStickyExpanded] = useState(false);
  const activeOverlayId = useTerminalOverlayFocus(
    (state) => state.activeOverlayId
  );
  // 鼠标命中：native 帧缩排前也把卡片几何注册进 EventRouter 打洞。
  const hitOverlay = useTerminalOverlayRegistration(
    `terminal-composer-hit:${panelId}`
  );
  const valueRef = useRef(value);
  valueRef.current = value;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // IME composing: freeze chrome mode switching to prevent compact↔expanded flicker.
  const composingRef = useRef(false);

  // Persist draft while typing so toggle-close (not only Esc) restores it.
  useEffect(() => {
    writeComposerDraft(panelId, value);
  }, [panelId, value]);

  const reportAttachmentError = useCallback(
    (titleKey: string, detail: string) => {
      showAppAlert({
        body: detail,
        title: t(titleKey),
      }).catch(() => undefined);
    },
    [t]
  );

  const attachments = useTerminalComposerAttachments({
    disabled,
    getDraftAndCursor: () => {
      const el = textareaRef.current;
      const draft = valueRef.current;
      const cursor = el?.selectionStart ?? draft.length;
      const selectionEnd = el?.selectionEnd ?? cursor;
      return { cursor, draft, selectionEnd };
    },
    onDraftChange: (draft, cursor) => {
      valueRef.current = draft;
      setValue(draft);
      if (cursor !== undefined) {
        queueMicrotask(() => {
          const el = textareaRef.current;
          if (!el) {
            return;
          }
          el.selectionStart = cursor;
          el.selectionEnd = cursor;
        });
      }
    },
    panelId,
    reportError: reportAttachmentError,
  });

  const canSend = !disabled && attachments.canSendWithDraft(value);

  // Root height → native inset. Cleanup zeros only on unmount — do not re-run
  // on every keystroke (would collapse native inset to reserve height).
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const report = () => {
      onHeightChange(root.getBoundingClientRect().height);
      hitOverlay.flush();
      // Freeze soft-wrap during IME composing — intermediate CJK candidates
      // cause rapid height fluctuation and compact↔expanded flicker.
      if (!composingRef.current) {
        const el = textareaRef.current;
        if (el) {
          setSoftWrapped(textareaSoftWrapped(el));
        }
      }
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(root);
    const el = textareaRef.current;
    if (el) {
      observer.observe(el);
    }
    return () => {
      observer.disconnect();
      onHeightChange(0);
    };
  }, [hitOverlay, onHeightChange]);

  // Soft-wrap may change without root resize when compact max-height clamps.
  // Also frozen during IME composing; re-evaluated on compositionEnd.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is the intentional recompute trigger for wrap detection
  useLayoutEffect(() => {
    if (composingRef.current) {
      return;
    }
    const el = textareaRef.current;
    if (el) {
      setSoftWrapped(textareaSoftWrapped(el));
    }
  }, [value]);

  // activate / surface 都 refocus 输入框 — Rich Input 打开时保持键盘所有权。
  //   Esc / 发送成功 才收起（见 onKeyDown 与 send）。
  useEffect(
    () =>
      registerTerminalComposerTakeover(panelId, (_reason) => {
        // Both activate (tab click) and surface (terminal content click)
        // refocus the composer input — Rich Input stays open and keeps
        // keyboard ownership. Only Esc / send close it.
        const el = textareaRef.current;
        if (!el || el.disabled) {
          return false;
        }
        return focusComposerInput(el, overlayId);
      }),
    [overlayId, panelId]
  );

  // 挂载 / 启用 / 切回激活面板 / 再次 Open：接管键盘。
  // focusRequest 有意列入依赖：已打开时再触发打开仍会 refocus（对齐搜索栏）。
  // rAF 再补一次，覆盖「点 tab 抢焦点」发生在 focus 之后的竞态。
  useEffect(() => {
    if (disabled || !isActive) {
      return;
    }
    const request = focusRequest;
    const focusNow = () => {
      if (request !== focusRequest) {
        return;
      }
      const el = textareaRef.current;
      if (!el || el.disabled) {
        return;
      }
      focusComposerInput(el, overlayId);
    };
    queueMicrotask(focusNow);
    const raf = requestAnimationFrame(focusNow);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [disabled, focusRequest, isActive, overlayId]);

  // 其它浮层（搜索栏等）抢走键盘时 blur 保持视觉一致；卡片保持可见。
  // 仅在「另一个」overlay 激活时 blur——activeOverlayId === null 时不要抢跑，
  // 否则会与挂载/切回时的 focus + activateOverlay 竞态，把刚聚焦的输入框打掉。
  useEffect(() => {
    if (activeOverlayId !== null && activeOverlayId !== overlayId) {
      textareaRef.current?.blur();
    }
  }, [activeOverlayId, overlayId]);

  // 卸载让出键盘声明；归还终端焦点由面板层处理（agent 退出场景）。
  useEffect(
    () => () => {
      useTerminalStore.getState().deactivateOverlay(overlayId);
    },
    [overlayId]
  );

  // disabled 转场对称让出：禁用元素的原生 blur 不触发 React 联动，须显式释放
  // 键盘声明，否则 Gate A（切面板回来）路径下 effective 键盘钉在 web。
  useEffect(() => {
    if (disabled) {
      useTerminalStore.getState().deactivateOverlay(overlayId);
    }
  }, [disabled, overlayId]);

  // 面板失活时让出键盘声明，避免切到其它终端后旧 overlay 仍占 webRequest。
  useEffect(() => {
    if (!isActive) {
      useTerminalStore.getState().deactivateOverlay(overlayId);
    }
  }, [isActive, overlayId]);

  const sendKey = (keycode: number, mods?: number) => {
    window.pier.terminal
      .sendKeyPress({
        keycode,
        panelId,
        ...(mods === undefined ? {} : { mods }),
      })
      .then((result) => {
        if (!result.ok) {
          reportComposerSendFailure(t, result.error ?? "");
        }
      })
      .catch((err: unknown) => {
        reportComposerSendFailure(
          t,
          err instanceof Error ? err.message : String(err)
        );
      });
  };

  const send = () => {
    if (disabled) {
      return;
    }
    const payload = attachments.buildPayloadOrReport(value);
    if (payload == null) {
      return;
    }
    window.pier.terminal
      .sendText({ panelId, submit: true, text: payload })
      .then((result) => {
        if (result.ok || result.textDelivered) {
          clearComposerDraft(panelId);
          setValue("");
          attachments.clearAll();
          onCloseRef.current();
          if (!result.ok) {
            reportComposerSendFailure(t, result.error ?? "");
          }
          return;
        }
        reportComposerSendFailure(t, result.error ?? "");
      })
      .catch((err: unknown) => {
        reportComposerSendFailure(
          t,
          err instanceof Error ? err.message : String(err)
        );
      });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      writeComposerDraft(panelId, valueRef.current);
      onCloseRef.current();
      return;
    }
    const keyPress = passthroughKeyPressForKey({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      empty: value === "",
      key: event.key,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
    if (keyPress !== null) {
      event.preventDefault();
      sendKey(keyPress.keycode, keyPress.mods);
      return;
    }
    if (event.key === "Enter") {
      // Mod/Shift/Alt+Enter: newline. Do not rely on browser default — Chromium
      // often does nothing for Meta+Enter, and Mod+Shift+Enter used to be stolen
      // by panel maximize before the text-input keybinding guard.
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        event.preventDefault();
        const el = event.currentTarget;
        const start = el.selectionStart ?? value.length;
        const end = el.selectionEnd ?? start;
        const next = `${value.slice(0, start)}\n${value.slice(end)}`;
        setValue(next);
        queueMicrotask(() => {
          const node = textareaRef.current;
          if (!node) {
            return;
          }
          const cursor = start + 1;
          node.selectionStart = cursor;
          node.selectionEnd = cursor;
        });
        return;
      }
      event.preventDefault();
      send();
    }
  };

  const setRootRef = (el: HTMLDivElement | null) => {
    rootRef.current = el;
    hitOverlay.ref(el);
  };

  const hasAttachments = attachments.attachments.length > 0;
  const hasHardNewline = value.includes("\n");
  /**
   * Chrome state machine (Cursor follow-up) with sticky expanded.
   *
   * Expand when: attachments | hard \n | soft-wrap (measured when !composing).
   * Collapse ONLY when draft is empty and there are no attachments.
   *
   * Why sticky: compact row is narrower (side buttons steal width) so the same
   * text soft-wraps in compact but fits one line in expanded — a pure
   * softWrapped boolean oscillates compact↔expanded (worse under CJK IME).
   */
  const wantExpand = hasAttachments || hasHardNewline || softWrapped;

  useLayoutEffect(() => {
    if (composingRef.current) {
      return;
    }
    if (wantExpand) {
      setStickyExpanded(true);
      return;
    }
    // Collapse only when truly empty — never because width-unwrapped soft wrap.
    if (!hasAttachments && value.trim() === "") {
      setStickyExpanded(false);
    }
  }, [hasAttachments, value, wantExpand]);

  // Expanded chrome is the multiline UI: hint + Send with Enter kbd always show.
  const compact = !(wantExpand || stickyExpanded);

  const focusInputFromChrome = (
    event: ReactMouseEvent<HTMLDivElement>
  ): void => {
    if (disabled) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    // Leave real controls / attachment chips alone. Do NOT match the rail
    // (`terminal-composer-attachment-rail`) — empty rail space should focus.
    if (
      target.closest(
        "button, a, input, textarea, [role='button'], .composer-attachment-surface"
      )
    ) {
      return;
    }
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    // Prevent the empty chrome from taking focus away after we focus the input.
    event.preventDefault();
    focusComposerInput(el, overlayId);
  };

  return (
    <TerminalComposerView
      attachments={attachments.attachments}
      bottomOffsetPx={bottomOffsetPx}
      canSend={canSend}
      compact={compact}
      composingRef={composingRef}
      disabled={disabled}
      hasAttachments={hasAttachments}
      onChromeMouseDown={focusInputFromChrome}
      onDragOver={attachments.onDragOver}
      onDrop={attachments.onDrop}
      onKeyDown={onKeyDown}
      onPaste={attachments.onPaste}
      onPickFiles={attachments.pickFiles}
      onRemoveAttachment={attachments.removeAttachment}
      onRevealPath={attachments.revealPath}
      onSend={send}
      onSetSoftWrapped={setSoftWrapped}
      onValueChange={setValue}
      overlayId={overlayId}
      setRootRef={setRootRef}
      textareaRef={textareaRef}
      value={value}
    />
  );
}
