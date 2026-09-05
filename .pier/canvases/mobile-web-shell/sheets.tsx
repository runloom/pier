import { type ReactNode, useEffect, useRef } from "react";
import {
  cx,
  IconButton,
  sessionSubtitle,
  TERMINAL_FONT_STEPS,
  TOUCH_PRESS,
} from "./chrome.tsx";
import { Icon } from "./icons.tsx";
import type { DemoSession } from "./model.ts";
import { SessionGlyph } from "./session-glyph.tsx";
import { SessionState, TerminalPreview } from "./terminal-preview.tsx";

/** 画板内的手机浮层：焦点留在面板内，关闭后回到入口。 */
function PhoneSheet(props: {
  autoFocus?: boolean | undefined;
  children: ReactNode;
  title: string;
  subtitle: string;
  onClose: () => void;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (props.autoFocus === false) return;
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [props.autoFocus]);
  return (
    <div
      className="absolute inset-0 z-30 flex flex-col justify-end"
      data-slot="mobile-sheet"
    >
      <button
        aria-label={`关闭${props.title}`}
        className="absolute inset-0 bg-overlay-scrim"
        onClick={props.onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-label={props.title}
        aria-modal="true"
        className="relative flex max-h-[78%] min-h-0 flex-col rounded-t-[24px] border border-border bg-surface-raised pb-6 shadow-lg"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            props.onClose();
          }
          if (event.key !== "Tab") return;
          const controls = ref.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)"
          );
          const first = controls?.[0];
          const last = controls?.[(controls?.length ?? 0) - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        ref={ref}
        role="dialog"
      >
        <div className="flex shrink-0 items-center gap-3 px-5 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-[18px] leading-6">
              {props.title}
            </h2>
            <p className="mt-1 truncate text-[13px] text-muted-foreground leading-5">
              {props.subtitle}
            </p>
          </div>
          <IconButton
            className="rounded-full bg-background"
            icon="x"
            label="关闭面板"
            onClick={props.onClose}
          />
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-3 [scrollbar-width:thin]">
          {props.children}
        </div>
      </div>
    </div>
  );
}

export function SessionSwitcher(props: {
  autoFocus?: boolean | undefined;
  currentId: string;
  onClose: () => void;
  onPick: (id: string) => void;
  sessions: readonly DemoSession[];
}): ReactNode {
  const waiting = props.sessions.filter((s) => s.status === "waiting").length;
  return (
    <PhoneSheet
      autoFocus={props.autoFocus}
      onClose={props.onClose}
      subtitle={`${props.sessions.length} 个会话${waiting > 0 ? ` · ${waiting} 个需要你处理` : ""}`}
      title="切换会话"
    >
      {props.sessions.map((session) => {
        const current = session.id === props.currentId;
        return (
          <button
            aria-current={current ? "true" : undefined}
            className={cx(
              "mb-1.5 flex min-h-[80px] w-full items-center gap-3 rounded-[14px] px-3 py-3 text-left",
              TOUCH_PRESS,
              current && "bg-background/45 ring-1 ring-border/70"
            )}
            key={session.id}
            onClick={() => props.onPick(session.id)}
            type="button"
          >
            <TerminalPreview compact session={session} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-semibold text-[15px] leading-5">
                <span className="truncate">{session.title}</span>
                {current ? (
                  <Icon
                    className="size-3.5 shrink-0 text-muted-foreground"
                    name="check"
                  />
                ) : null}
              </span>
              <span className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground leading-4">
                <SessionGlyph session={session} size={12} />
                <span className="truncate">{sessionSubtitle(session)}</span>
              </span>
            </span>
            <span className="shrink-0">
              <SessionState session={session} />
            </span>
          </button>
        );
      })}
    </PhoneSheet>
  );
}

const FONT_LABELS = ["紧凑", "标准", "舒适"] as const;
export function ReadingSheet(props: {
  fontIndex: number;
  onChange: (index: number) => void;
  onClose: () => void;
}): ReactNode {
  return (
    <PhoneSheet
      onClose={props.onClose}
      subtitle="调整阅读大小，不影响电脑上的终端"
      title="终端字号"
    >
      <div className="grid grid-cols-3 gap-2 px-1 pb-4">
        {FONT_LABELS.map((label, index) => (
          <button
            aria-pressed={props.fontIndex === index}
            className={cx(
              "flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-xl border active:bg-interactive-active",
              props.fontIndex === index
                ? "border-action-accent bg-secondary"
                : "border-border"
            )}
            key={label}
            onClick={() => props.onChange(index)}
            type="button"
          >
            <span className={cx("font-mono", TERMINAL_FONT_STEPS[index])}>
              Aa 字
            </span>
            <span className="text-[13px]">{label}</span>
          </button>
        ))}
      </div>
      <pre
        className={cx(
          "mx-1 whitespace-pre-wrap rounded-xl bg-surface-inset p-4 font-mono",
          TERMINAL_FONT_STEPS[props.fontIndex]
        )}
      >
        {"❯ git status\n当前工作树没有未提交的变更。\nReady when you are."}
      </pre>
    </PhoneSheet>
  );
}
