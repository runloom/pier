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
import type { StructuredComposerEditorHandle } from "./structured-composer/structured-composer-editor.tsx";
import { registerComposerDraftSinkForTests } from "./structured-composer/structured-composer-test-registry.ts";
import {
  clearComposerDraft,
  elementSoftWrapped,
  focusComposerInput,
  readComposerDraft,
  reportComposerSendFailure,
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
  /** Bumped to open the OS file picker (keyboard shortcut / command). */
  attachRequest?: number;
  bottomOffsetPx: number;
  disabled: boolean;
  /** Bumped when Rich Input opens so the editor receives focus. */
  focusRequest?: number;
  /** 面板是否为当前激活 tab；切回时补聚焦。 */
  isActive: boolean;
  /** Panel-owned close: Esc / send success. Terminal surface click does NOT close. */
  onClose: () => void;
  onHeightChange: (heightPx: number) => void;
  panelId: string;
  /** Absolute project root for @ mentions; null when no workspace. */
  projectRootPath?: string | null;
}

export function TerminalComposer({
  attachRequest = 0,
  bottomOffsetPx,
  disabled,
  focusRequest = 0,
  isActive,
  onClose,
  onHeightChange,
  panelId,
  projectRootPath = null,
}: TerminalComposerProps) {
  const t = useT();
  const overlayId = `terminal-composer:${panelId}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<StructuredComposerEditorHandle>(null);
  const [value, setValue] = useState(() => readComposerDraft(panelId));
  const [softWrapped, setSoftWrapped] = useState(false);
  const [stickyExpanded, setStickyExpanded] = useState(false);
  const activeOverlayId = useTerminalOverlayFocus(
    (state) => state.activeOverlayId
  );
  const hitOverlay = useTerminalOverlayRegistration(
    `terminal-composer-hit:${panelId}`
  );
  const valueRef = useRef(value);
  valueRef.current = value;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const composingRef = useRef(false);

  useEffect(() => {
    writeComposerDraft(panelId, value);
  }, [panelId, value]);

  useEffect(() => registerComposerDraftSinkForTests(setValue), []);

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
    editorMutations: {
      getSelection: () =>
        editorRef.current?.getSelection() ?? {
          cursor: valueRef.current.length,
          selectionEnd: valueRef.current.length,
        },
      getValue: () => editorRef.current?.getValue() ?? valueRef.current,
      insertAttachmentToken: (absolutePath, ordinal1Based) => {
        editorRef.current?.insertAttachmentToken(absolutePath, ordinal1Based);
      },
      insertTextAtSelection: (text) => {
        editorRef.current?.insertTextAtSelection(text);
      },
      listInvalidAttachmentRefs: (atts) =>
        editorRef.current?.listInvalidAttachmentRefs(atts) ?? [],
      rewriteAttachmentTokensAfterRemove: (removedPath, nextAttachments) =>
        editorRef.current?.rewriteAttachmentTokensAfterRemove(
          removedPath,
          nextAttachments
        ) ?? valueRef.current,
    },
    getDraftAndCursor: () => {
      const handle = editorRef.current;
      const draft = valueRef.current;
      if (!handle) {
        return { cursor: draft.length, draft, selectionEnd: draft.length };
      }
      const selection = handle.getSelection();
      return {
        cursor: selection.cursor,
        draft,
        selectionEnd: selection.selectionEnd,
      };
    },
    onDraftChange: (draft, cursor) => {
      valueRef.current = draft;
      setValue(draft);
      queueMicrotask(() => {
        const handle = editorRef.current;
        if (!handle) {
          return;
        }
        // Lexical-preserving mutations already updated the editor; only
        // rewrite when the controlled draft truly diverged (e.g. tests).
        if (handle.getValue() !== draft) {
          handle.setValue(draft);
        }
        if (cursor !== undefined) {
          handle.setSelection(cursor);
        }
      });
    },
    panelId,
    reportError: reportAttachmentError,
    t,
  });

  const canSend = !disabled && attachments.canSendWithDraft(value);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const report = () => {
      onHeightChange(root.getBoundingClientRect().height);
      hitOverlay.flush();
      if (!composingRef.current) {
        const el = editorRef.current?.getElement();
        if (el) {
          setSoftWrapped(elementSoftWrapped(el));
        }
      }
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(root);
    const el = editorRef.current?.getElement();
    if (el) {
      observer.observe(el);
    }
    return () => {
      observer.disconnect();
      onHeightChange(0);
    };
  }, [hitOverlay, onHeightChange]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` triggers wrap recompute
  useLayoutEffect(() => {
    if (composingRef.current) {
      return;
    }
    const el = editorRef.current?.getElement();
    if (el) {
      setSoftWrapped(elementSoftWrapped(el));
    }
  }, [value]);

  useEffect(
    () =>
      registerTerminalComposerTakeover(panelId, (_reason) => {
        const el = editorRef.current?.getElement();
        if (!el || disabled) {
          return false;
        }
        return focusComposerInput(el, overlayId);
      }),
    [disabled, overlayId, panelId]
  );

  useEffect(() => {
    if (disabled || !isActive) {
      return;
    }
    const request = focusRequest;
    const focusNow = () => {
      if (request !== focusRequest) {
        return;
      }
      const el = editorRef.current?.getElement();
      if (!el || disabled) {
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

  const attachPickFilesRef = useRef(attachments.pickFiles);
  attachPickFilesRef.current = attachments.pickFiles;
  const lastAttachRequestRef = useRef(0);

  useEffect(() => {
    if (attachRequest <= 0) {
      lastAttachRequestRef.current = 0;
      return;
    }
    if (disabled || attachRequest === lastAttachRequestRef.current) {
      return;
    }
    lastAttachRequestRef.current = attachRequest;
    // Fire once per attachRequest bump only — never re-open the picker when
    // pickFiles's useCallback identity churns or the composer remounts with a
    // stale counter (parent resets to 0 on close).
    const timer = window.setTimeout(() => {
      attachPickFilesRef.current();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [attachRequest, disabled]);

  useEffect(() => {
    if (activeOverlayId !== null && activeOverlayId !== overlayId) {
      editorRef.current?.blur();
    }
  }, [activeOverlayId, overlayId]);

  useEffect(
    () => () => {
      useTerminalStore.getState().deactivateOverlay(overlayId);
    },
    [overlayId]
  );

  useEffect(() => {
    if (disabled) {
      useTerminalStore.getState().deactivateOverlay(overlayId);
    }
  }, [disabled, overlayId]);

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

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Escape") {
      // Lexical may close the mention menu first (ref → false + preventDefault).
      // Treat that as "Esc consumed by popup" and do not close Rich Input.
      if (event.defaultPrevented) {
        return;
      }
      if (editorRef.current?.isMentionMenuOpen()) {
        event.preventDefault();
        event.stopPropagation();
        editorRef.current.dismissMentionMenu();
        return;
      }
      event.preventDefault();
      writeComposerDraft(panelId, valueRef.current);
      onCloseRef.current();
      return;
    }
    // Mention menu owns arrows / Enter; do not bridge them to the TUI.
    if (editorRef.current?.isMentionMenuOpen()) {
      return;
    }
    const draftEmpty =
      valueRef.current === "" && attachments.attachments.length === 0;
    const keyPress = passthroughKeyPressForKey({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      empty: draftEmpty,
      key: event.key,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
    if (keyPress !== null) {
      event.preventDefault();
      sendKey(keyPress.keycode, keyPress.mods);
      return;
    }
    // Enter / Shift+Enter handled by Lexical EnterKeyPlugin.
  };

  const setRootRef = (el: HTMLDivElement | null) => {
    rootRef.current = el;
    hitOverlay.ref(el);
  };

  const hasAttachments = attachments.attachments.length > 0;
  const hasHardNewline = value.includes("\n");
  // Empty draft cannot soft-wrap; ignore false positives from compact
  // `h-full` shell height vs shorter line-height (see elementSoftWrapped).
  const softWrapExpand = softWrapped && value.trim() !== "";
  const wantExpand = hasAttachments || hasHardNewline || softWrapExpand;

  useLayoutEffect(() => {
    if (composingRef.current) {
      return;
    }
    if (wantExpand) {
      setStickyExpanded(true);
      return;
    }
    if (!hasAttachments && value.trim() === "") {
      setStickyExpanded(false);
    }
  }, [hasAttachments, value, wantExpand]);

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
    if (
      target.closest(
        "button, a, input, textarea, [role='button'], .composer-attachment-surface"
      )
    ) {
      return;
    }
    const el = editorRef.current?.getElement();
    if (!el) {
      return;
    }
    // Do not steal mousedown inside the editor — that kills drag-select.
    if (el === target || el.contains(target)) {
      return;
    }
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
      editorRef={editorRef}
      hasAttachments={hasAttachments}
      onChromeMouseDown={focusInputFromChrome}
      onDragOver={attachments.onDragOver}
      onDrop={attachments.onDrop}
      onKeyDown={onKeyDown}
      onLargePlainPaste={attachments.onLargePlainPaste}
      onPaste={attachments.onPaste}
      onPickFiles={attachments.pickFiles}
      onRemoveAttachment={attachments.removeAttachment}
      onRevealPath={attachments.revealPath}
      onSend={send}
      onSetSoftWrapped={setSoftWrapped}
      onValueChange={setValue}
      overlayId={overlayId}
      projectRootPath={projectRootPath}
      setRootRef={setRootRef}
      value={value}
    />
  );
}
