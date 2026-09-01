import { Badge, Row, Text } from "pier/canvas";
import type { ReactNode } from "react";

export function cx(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

/**
 * 产品壳。Artboard phone 已经是外框，这里不再画 9:41 / Home 条。
 */
export function PhoneShell(props: {
  title: string;
  backLabel?: string | undefined;
  children: ReactNode;
  context?: string | undefined;
  footer?: ReactNode;
  onBack?: (() => void) | undefined;
  trailing?: ReactNode;
}): ReactNode {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex min-h-11 shrink-0 items-center gap-1 px-2 pt-1">
        {props.onBack === undefined ? (
          <span className="w-9 shrink-0" />
        ) : (
          <button
            className="flex min-h-11 shrink-0 items-center rounded-xl px-2 text-sm active:bg-interactive-active"
            onClick={props.onBack}
            type="button"
          >
            ‹ {props.backLabel ?? "返回"}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-center font-semibold text-[17px] leading-5">
            {props.title}
          </h1>
          {props.context === undefined ? null : (
            <p className="truncate text-center text-[11px] text-muted-foreground leading-4">
              {props.context}
            </p>
          )}
        </div>
        <div className="flex min-w-9 shrink-0 justify-end">{props.trailing}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{props.children}</div>
      {props.footer}
    </div>
  );
}

export function BellButton(props: {
  onClick?: (() => void) | undefined;
  unread?: boolean;
}): ReactNode {
  return (
    <button
      aria-label={props.unread === true ? "通知，有未读" : "通知"}
      className="relative flex size-11 items-center justify-center rounded-xl active:bg-interactive-active"
      onClick={props.onClick}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
      >
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10 21h4" />
      </svg>
      {props.unread === true ? (
        <span className="absolute top-2.5 right-2 size-1.5 rounded-full bg-action-danger" />
      ) : null}
    </button>
  );
}

export function HitButton(props: {
  children: ReactNode;
  className?: string;
  onClick?: (() => void) | undefined;
  variant?: "accent" | "outline" | "ghost" | "danger";
}): ReactNode {
  const variant = props.variant ?? "accent";
  return (
    <button
      className={cx(
        "flex min-h-11 items-center justify-center rounded-xl px-4 font-medium text-sm transition-colors duration-75 active:opacity-80",
        variant === "accent" &&
          "bg-action-accent text-action-accent-foreground",
        variant === "outline" &&
          "border border-border bg-background active:bg-interactive-active",
        variant === "ghost" &&
          "text-muted-foreground active:bg-interactive-active",
        variant === "danger" &&
          "bg-action-danger/10 text-action-danger active:bg-action-danger/20",
        props.className
      )}
      onClick={props.onClick}
      type="button"
    >
      {props.children}
    </button>
  );
}

export function HeaderLink(props: {
  children: ReactNode;
  onClick?: (() => void) | undefined;
}): ReactNode {
  return (
    <button
      className="flex min-h-11 items-center px-1.5 text-sm active:bg-interactive-active"
      onClick={props.onClick}
      type="button"
    >
      {props.children}
    </button>
  );
}

export function PressRow(props: {
  children: ReactNode;
  className?: string;
  onClick?: (() => void) | undefined;
  pressed?: boolean;
  tone?: "default" | "waiting";
}): ReactNode {
  return (
    <button
      className={cx(
        "flex min-h-11 w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors duration-75",
        props.tone === "waiting"
          ? "border-status-warning-border bg-status-warning-bg active:bg-status-warning-bg"
          : "border-border bg-card active:bg-interactive-active",
        props.pressed === true && "bg-interactive-active",
        props.className
      )}
      onClick={props.onClick}
      type="button"
    >
      {props.children}
    </button>
  );
}

export function SectionLabel(props: {
  children: ReactNode;
  trailing?: ReactNode;
}): ReactNode {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <p className="font-medium text-[11px] text-muted-foreground tracking-wide">
        {props.children}
      </p>
      {props.trailing}
    </div>
  );
}

export function ConnBadge(props: {
  state: "online" | "offline" | "connecting";
}): ReactNode {
  if (props.state === "online") {
    return <Badge variant="success">在线</Badge>;
  }
  if (props.state === "connecting") {
    return <Badge variant="warning">连接中</Badge>;
  }
  return <Badge variant="neutral">离线</Badge>;
}

export function CaptionCard(props: {
  badge: string;
  children: ReactNode;
  title: string;
}): ReactNode {
  return (
    <div className="flex w-[420px] flex-col gap-2 rounded-md border border-border bg-muted/40 p-4">
      <Row gap={8}>
        <Badge variant="secondary">{props.badge}</Badge>
        <Text as="h3">{props.title}</Text>
      </Row>
      {props.children}
    </div>
  );
}
