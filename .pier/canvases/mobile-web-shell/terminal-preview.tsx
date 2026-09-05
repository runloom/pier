import type { ReactNode } from "react";
import { cx } from "./chrome.tsx";
import { Icon } from "./icons.tsx";
import { type DemoSession, screenText } from "./model.ts";

const STATE_LABEL = {
  waiting: "需要你处理",
  processing: "运行中",
  ready: "就绪",
} as const;

export function SessionState({ session }: { session: DemoSession }): ReactNode {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-[14px]",
        session.status === "waiting"
          ? "bg-status-warning-bg text-status-warning-fg"
          : session.status === "processing"
            ? "bg-status-info-bg text-status-info-fg"
            : "text-muted-foreground"
      )}
    >
      <span
        className={cx(
          "size-1 shrink-0 rounded-full",
          session.status === "waiting"
            ? "bg-warning"
            : session.status === "processing"
              ? "bg-info"
              : "bg-muted-foreground"
        )}
      />
      {STATE_LABEL[session.status]}
    </span>
  );
}

/** 保留屏幕原始行形；溢出时优先露出末尾输出。 */
export function TerminalPreview(props: {
  session: DemoSession;
  compact?: boolean;
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "relative block aspect-square overflow-hidden border border-border/80 bg-surface-raised shadow-xs [container-type:inline-size]",
        props.compact ? "w-14 shrink-0 rounded-[9px]" : "rounded-[14px]"
      )}
      data-slot="terminal-preview"
    >
      {props.compact ? null : (
        <span className="absolute inset-x-0 top-0 flex h-7 items-center justify-between gap-2 px-2.5">
          <Icon className="size-3 text-muted-foreground" name="terminal" />
          <SessionState session={props.session} />
        </span>
      )}
      <span
        className={cx(
          "pointer-events-none absolute overflow-hidden bg-background",
          props.compact
            ? "inset-[3px] rounded-[5px]"
            : "inset-x-1 bottom-1 top-7 rounded-[9px] rounded-t-[3px]"
        )}
      >
        <span
          className="absolute inset-[6%] flex flex-col justify-end overflow-hidden"
          data-slot="terminal-preview-content"
        >
          <span
            className="block min-h-full shrink-0 whitespace-pre font-mono text-[3.6cqw] text-foreground/85 leading-[1.55]"
            data-slot="terminal-preview-text"
          >
            {screenText(props.session.screen)}
          </span>
        </span>
      </span>
    </span>
  );
}
