import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@pier/ui/input-group.tsx";
import { useTerminalOverlayRegistration } from "@pier/ui/use-terminal-overlay.tsx";
import { cn } from "@pier/ui/utils.ts";
import { ArrowUp } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
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
import { passthroughKeyPressForKey } from "./terminal-composer-passthrough.ts";

/** 卡片与终端内容 / 状态栏之间的呼吸间距。 */
export const TERMINAL_COMPOSER_GAP_PX = 8;

/**
 * 单行胶囊未实测前的预留高度：首帧就缩 native 帧，避免叠在未打洞区域上点不中。
 * 与 InputGroup 单行实测高度大致对齐。
 */
export const TERMINAL_COMPOSER_RESERVE_HEIGHT_PX = 44;

/** textarea 实测高度超过该值视为多行态（单行 36px + 容差）。 */
const MULTILINE_THRESHOLD_PX = 44;

/** Per-panel draft retained across on-demand open/close. */
const drafts = new Map<string, string>();

export function resetTerminalComposerDraftsForTests(): void {
  drafts.clear();
}

interface TerminalComposerProps {
  bottomOffsetPx: number;
  disabled: boolean;
  /** Bumped on every Open Rich Input request so already-open composer refocuses. */
  focusRequest?: number;
  /** 面板是否为当前激活 tab；切回时补聚焦。 */
  isActive: boolean;
  /** Panel-owned close: Esc / send success / terminal click takeover. */
  onClose: () => void;
  onHeightChange: (heightPx: number) => void;
  panelId: string;
}

function reportSendFailure(t: (key: string) => string, detail: string): void {
  showAppAlert({
    body: detail,
    title: t("terminal.composer.sendFailed"),
  }).catch(() => undefined);
}

function focusComposerInput(
  el: HTMLTextAreaElement,
  overlayId: string
): boolean {
  el.focus();
  if (document.activeElement !== el) {
    return false;
  }
  useTerminalStore.getState().activateOverlay(overlayId);
  return true;
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
  const [value, setValue] = useState(() => drafts.get(panelId) ?? "");
  // 胶囊 ↔ 卡片形态：单行是 rounded-full 胶囊，内容撑高后切换为
  // 圆角卡片 + 快捷键提示行。由 textarea 实测高度驱动（field-sizing 自动增高）。
  const [multiline, setMultiline] = useState(false);
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

  // 实测高度上报：field-sizing 自动增高经此驱动内容区 inset；卸载归零。
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const report = () => {
      onHeightChange(root.getBoundingClientRect().height);
      hitOverlay.flush();
      const el = textareaRef.current;
      if (el) {
        setMultiline(
          el.getBoundingClientRect().height >= MULTILINE_THRESHOLD_PX
        );
      }
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(root);
    return () => {
      observer.disconnect();
      onHeightChange(0);
    };
  }, [hitOverlay, onHeightChange]);

  // activate：面板激活 / 点 tab → 仍打开则 refocus 输入框。
  // surface：点终端内容 → 存草稿关闭，返回 false 让 host 归还 TUI。
  useEffect(
    () =>
      registerTerminalComposerTakeover(panelId, (reason) => {
        if (reason === "surface") {
          drafts.set(panelId, valueRef.current);
          onCloseRef.current();
          return false;
        }
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
          reportSendFailure(t, result.error ?? "");
        }
      })
      .catch((err: unknown) => {
        reportSendFailure(t, err instanceof Error ? err.message : String(err));
      });
  };

  const send = () => {
    const text = value;
    if (text.trim() === "" || disabled) {
      return;
    }
    window.pier.terminal
      .sendText({ panelId, submit: true, text })
      .then((result) => {
        if (result.ok) {
          drafts.delete(panelId);
          setValue("");
          onCloseRef.current();
          return;
        }
        // 文本已进 agent 草稿区：清空避免重试重复粘贴并关闭。
        if (result.textDelivered) {
          drafts.delete(panelId);
          setValue("");
          onCloseRef.current();
        }
        reportSendFailure(t, result.error ?? "");
      })
      .catch((err: unknown) => {
        reportSendFailure(t, err instanceof Error ? err.message : String(err));
      });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      drafts.set(panelId, valueRef.current);
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const setRootRef = (el: HTMLDivElement | null) => {
    rootRef.current = el;
    hitOverlay.ref(el);
  };

  return (
    <div
      className="absolute inset-x-2 z-10"
      ref={setRootRef}
      style={{ bottom: bottomOffsetPx + TERMINAL_COMPOSER_GAP_PX }}
    >
      <InputGroup
        aria-label={t("terminal.composer.label")}
        className={cn(
          "border-border bg-popover text-popover-foreground shadow-background/40 shadow-lg transition-[color,box-shadow,border-radius]",
          multiline ? "rounded-2xl" : "rounded-full"
        )}
        data-testid="terminal-composer"
      >
        <InputGroupTextarea
          className={cn(
            "field-sizing-content max-h-48 min-h-9 w-full font-mono text-sm placeholder:text-muted-foreground/65",
            multiline ? "px-3.5" : "px-4"
          )}
          data-testid="terminal-composer-input"
          disabled={disabled}
          onChange={(event) => setValue(event.currentTarget.value)}
          onFocus={() => useTerminalStore.getState().activateOverlay(overlayId)}
          onKeyDown={onKeyDown}
          placeholder={t("terminal.composer.placeholder")}
          ref={textareaRef}
          rows={1}
          value={value}
        />
        {multiline ? (
          <InputGroupAddon align="block-end">
            <span
              aria-hidden="true"
              className="text-[10px] text-muted-foreground/60"
            >
              {t("terminal.composer.keyHint")}
            </span>
            <InputGroupButton
              aria-label={t("terminal.composer.send")}
              className="ml-auto rounded-full"
              data-testid="terminal-composer-send"
              disabled={disabled || value.trim() === ""}
              onClick={send}
              size="icon-xs"
              variant="default"
            >
              <ArrowUp />
            </InputGroupButton>
          </InputGroupAddon>
        ) : (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={t("terminal.composer.send")}
              className="rounded-full"
              data-testid="terminal-composer-send"
              disabled={disabled || value.trim() === ""}
              onClick={send}
              size="icon-xs"
              variant="default"
            >
              <ArrowUp />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
    </div>
  );
}
