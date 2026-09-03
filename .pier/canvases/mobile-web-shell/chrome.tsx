import { Badge, Row as CanvasRow, Text } from "pier/canvas";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons.tsx";
import type {
  DemoSession,
  DeviceKind,
  HostStatus,
  ScreenLine,
  SessionStatus,
} from "./model.ts";

export function cx(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

/**
 * 手机壳的触控积木。字号只用四档：标题 17 / 正文 15 / 说明 13 / 注 12；
 * 主路径命中 44px；按下一律自绘 `bg-interactive-active`（主按钮 `opacity-80`）。
 * Artboard phone 已是外框，这里不画 9:41 / Home 条。
 */
export function PhoneShell(props: {
  children: ReactNode;
  footer?: ReactNode;
  nav: ReactNode;
  overlay?: ReactNode;
  /** terminal：当前屏幕铺满，顶栏和键行叠在上面。page：普通列表面。 */
  tone?: "page" | "terminal" | undefined;
}): ReactNode {
  if (props.tone === "terminal") {
    return (
      <div className="relative h-full min-h-0 overflow-hidden bg-surface-inset text-foreground antialiased">
        <div className="absolute inset-0 flex flex-col">{props.children}</div>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-surface-inset via-surface-inset/55 to-transparent">
          <div className="pointer-events-auto">{props.nav}</div>
        </div>
        {props.footer === undefined ? null : (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-surface-inset via-surface-inset/80 to-transparent pt-12">
            <div className="pointer-events-auto">{props.footer}</div>
          </div>
        )}
        {props.overlay}
      </div>
    );
  }
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground antialiased">
      {props.nav}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {props.children}
        {props.overlay}
      </div>
      {props.footer}
    </div>
  );
}

export function NavBar(props: {
  back?: { label: string; onClick?: (() => void) | undefined } | undefined;
  backIconOnly?: boolean | undefined;
  divider?: boolean | undefined;
  ghost?: boolean | undefined;
  /** split：返回 | 标题 | 动作，给会话驾驶舱。overlay：iOS 居中标题。 */
  layout?: "overlay" | "split" | undefined;
  onTitleClick?: (() => void) | undefined;
  subtitle?: ReactNode;
  titleOpen?: boolean | undefined;
  title?: string | undefined;
  trailing?: ReactNode;
}): ReactNode {
  const hasCenter = props.title !== undefined || props.subtitle !== undefined;
  if (
    props.back === undefined &&
    !hasCenter &&
    props.trailing === undefined
  ) {
    return null;
  }
  const layout = props.layout ?? "overlay";
  const back = props.back === undefined ? null : (
    <button
      aria-label={`返回${props.back.label}`}
      className={cx(
        "flex min-h-11 items-center rounded-xl transition-colors duration-75 active:bg-interactive-active",
        props.backIconOnly === true ? "w-11 justify-center" : "max-w-full gap-0.5 pr-2.5 pl-1"
      )}
      onClick={props.back.onClick}
      type="button"
    >
      <Icon className={cx("size-6 shrink-0", props.backIconOnly !== true && "-ml-0.5")} name="chevron-left" />
      {props.backIconOnly === true ? null : (
        <span className="truncate text-[15px] leading-5">{props.back.label}</span>
      )}
    </button>
  );

  const titleBlock = (
    <>
      {props.title === undefined ? null : (
        <span className="flex max-w-full items-center gap-0.5">
          <span className="truncate font-semibold text-[17px] leading-[22px] tracking-[-0.01em]">
            {props.title}
          </span>
          {props.onTitleClick === undefined ? null : (
            <Icon
              className="size-4 shrink-0 text-muted-foreground"
              name="chevron-down"
            />
          )}
        </span>
      )}
      {props.subtitle === undefined ? null : (
        <div className="flex max-w-full items-center gap-1.5 text-muted-foreground text-xs leading-4">
          {props.subtitle}
        </div>
      )}
    </>
  );

  const titleNode =
    props.onTitleClick === undefined ? (
      <div className="flex min-w-0 flex-col justify-center">{titleBlock}</div>
    ) : (
      <button
        aria-expanded={props.titleOpen === true}
        aria-haspopup="listbox"
        aria-label={`${props.title ?? "会话"}，切换会话`}
        className="flex min-h-11 min-w-0 flex-col justify-center rounded-xl px-1.5 text-left transition-colors duration-75 active:bg-interactive-active"
        onClick={props.onTitleClick}
        type="button"
      >
        {titleBlock}
      </button>
    );

  return (
    <header
      className={cx(
        "relative flex h-[52px] shrink-0 items-center px-1.5",
        props.ghost !== true && props.divider === true && "border-border/70 border-b"
      )}
    >
      {layout === "split" ? (
        <>
          <div className="z-10 flex shrink-0 items-center">{back}</div>
          <div className="min-w-0 flex-1 px-1">{hasCenter ? titleNode : null}</div>
          <div className="z-10 flex shrink-0 items-center gap-0.5">
            {props.trailing}
          </div>
        </>
      ) : (
        <>
          <div className="z-10 flex min-w-0 max-w-[40%] items-center justify-start">
            {back}
          </div>
          {hasCenter ? (
            <div className="pointer-events-none absolute inset-x-16 flex h-full flex-col items-center justify-center">
              {props.onTitleClick === undefined ? (
                titleBlock
              ) : (
                <div className="pointer-events-auto">{titleNode}</div>
              )}
            </div>
          ) : null}
          <div className="z-10 ml-auto flex min-w-0 max-w-[46%] items-center justify-end gap-0.5">
            {props.trailing}
          </div>
        </>
      )}
    </header>
  );
}

/** 根面大标题（主机）。推入页用 NavBar 居中标题，不混用。 */
export function LargeTitle(props: {
  subtitle?: string | undefined;
  title: string;
}): ReactNode {
  return (
    <div className="px-5 pt-0.5 pb-2">
      <h1 className="font-bold text-[30px] leading-9 tracking-[-0.022em]">
        {props.title}
      </h1>
      {props.subtitle === undefined ? null : (
        <p className="mt-0.5 text-[13px] text-muted-foreground leading-[18px]">
          {props.subtitle}
        </p>
      )}
    </div>
  );
}

export function Body(props: {
  children: ReactNode;
  className?: string | undefined;
}): ReactNode {
  return (
    <div
      className={cx(
        "flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-1 pb-8 [scrollbar-width:none]",
        props.className
      )}
    >
      {props.children}
    </div>
  );
}

/** 内嵌成组列表：一块卡，行间细线，整行命中。 */
export function Group(props: {
  children: ReactNode;
  className?: string | undefined;
}): ReactNode {
  return (
    <div
      className={cx(
        "divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-card",
        props.className
      )}
    >
      {props.children}
    </div>
  );
}

export function ListRow(props: {
  chevron?: boolean | undefined;
  className?: string | undefined;
  leading?: ReactNode;
  mono?: boolean | undefined;
  onClick?: (() => void) | undefined;
  pressed?: boolean | undefined;
  subtitle?: ReactNode;
  tile?: "tinted" | "plain" | undefined;
  title: ReactNode;
  tone?: "default" | "waiting" | undefined;
  trailing?: ReactNode;
}): ReactNode {
  const tile = props.tile ?? "tinted";
  return (
    <button
      className={cx(
        "flex min-h-[56px] w-full items-center gap-3 px-4 text-left transition-colors duration-75",
        props.tone === "waiting"
          ? "bg-status-warning-bg/70 active:bg-status-warning-bg"
          : "active:bg-interactive-active",
        props.pressed === true && "bg-interactive-active",
        props.className
      )}
      onClick={props.onClick}
      type="button"
    >
      {props.leading === undefined ? null : (
        <span
          className={cx(
            "flex shrink-0 items-center justify-center",
            tile === "tinted"
              ? "size-9 rounded-[10px] bg-secondary text-foreground/85"
              : "size-6 text-muted-foreground"
          )}
        >
          {props.leading}
        </span>
      )}
      <span className="min-w-0 flex-1 py-2.5">
        <span
          className={cx(
            "block truncate text-[15px] leading-5",
            props.mono && "font-mono text-[13px]"
          )}
        >
          {props.title}
        </span>
        {props.subtitle === undefined ? null : (
          <span className="mt-0.5 block truncate text-[12px] text-muted-foreground leading-4">
            {props.subtitle}
          </span>
        )}
      </span>
      {props.trailing}
      {props.chevron === true ? (
        <Icon
          className="-mr-1.5 size-5 shrink-0 text-muted-foreground/50"
          name="chevron-right"
        />
      ) : null}
    </button>
  );
}

export function HitButton(props: {
  ariaLabel?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
  disabled?: boolean | undefined;
  icon?: IconName | undefined;
  onClick?: (() => void) | undefined;
  variant?: "accent" | "outline" | "tinted" | "ghost" | "danger" | undefined;
}): ReactNode {
  const variant = props.variant ?? "accent";
  return (
    <button
      aria-label={props.ariaLabel}
      className={cx(
        "flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-medium text-[15px] leading-5 transition-[background-color,opacity] duration-75 disabled:opacity-50",
        variant === "accent" &&
          "bg-action-accent text-action-accent-foreground active:opacity-80",
        variant === "outline" &&
          "border border-border bg-card active:bg-interactive-active",
        variant === "tinted" && "bg-secondary active:bg-interactive-active",
        variant === "ghost" && "active:bg-interactive-active",
        variant === "danger" &&
          "bg-status-danger-bg text-status-danger-fg active:opacity-80",
        props.className
      )}
      disabled={props.disabled}
      onClick={props.onClick}
      type="button"
    >
      {props.icon === undefined ? null : (
        <Icon className="size-[18px] shrink-0" name={props.icon} />
      )}
      {props.children}
    </button>
  );
}

/** 顶栏文字动作（变更 / 文件 / 全部已读 / 编辑）。 */
export function NavAction(props: {
  children: ReactNode;
  onClick?: (() => void) | undefined;
  tone?: "default" | "muted" | undefined;
}): ReactNode {
  return (
    <button
      className={cx(
        "flex min-h-11 items-center rounded-xl px-2 text-[15px] leading-5 transition-colors duration-75 active:bg-interactive-active",
        props.tone === "muted" && "text-muted-foreground"
      )}
      onClick={props.onClick}
      type="button"
    >
      {props.children}
    </button>
  );
}

export function IconButton(props: {
  className?: string | undefined;
  dot?: boolean | undefined;
  icon: IconName;
  label: string;
  onClick?: (() => void) | undefined;
  spinning?: boolean | undefined;
}): ReactNode {
  return (
    <button
      aria-label={props.label}
      className={cx(
        "relative flex size-11 items-center justify-center rounded-xl transition-colors duration-75 active:bg-interactive-active",
        props.className
      )}
      onClick={props.onClick}
      type="button"
    >
      <Icon
        className={cx("size-[22px]", props.spinning === true && "animate-spin")}
        name={props.icon}
      />
      {props.dot === true ? (
        <span className="absolute top-2 right-2 size-2 rounded-full bg-action-danger ring-2 ring-background" />
      ) : null}
    </button>
  );
}

/** 终端底栏键帽：常驻 Esc / Enter / Tab；等待时高亮审批键。 */
export function KeyCap(props: {
  children: ReactNode;
  disabled?: boolean | undefined;
  label?: string | undefined;
  onClick?: (() => void) | undefined;
  tone?: "default" | "accent" | "waiting" | undefined;
  wide?: boolean | undefined;
}): ReactNode {
  const tone = props.tone ?? "default";
  return (
    <button
      aria-label={props.label}
      className={cx(
        "flex h-11 shrink-0 items-center justify-center rounded-[10px] font-mono text-[13px] leading-none ring-1 transition-[background-color,opacity] duration-75 disabled:opacity-35",
        props.wide === true ? "min-w-[4.25rem] px-3" : "min-w-11 px-2.5",
        tone === "accent" &&
          "bg-action-accent font-medium text-action-accent-foreground ring-action-accent active:opacity-80",
        tone === "waiting" &&
          "bg-status-warning-bg font-medium text-status-warning-fg ring-status-warning-border active:opacity-80",
        tone === "default" &&
          "bg-secondary ring-border active:bg-interactive-active"
      )}
      disabled={props.disabled}
      onClick={props.onClick}
      type="button"
    >
      {props.children}
    </button>
  );
}

const DEVICE_ICON: Record<DeviceKind, IconName> = {
  laptop: "laptop",
  mini: "mini",
  studio: "studio",
};

/** 主机卡上的设备图标；连接态点落在图标右下，不是一行文字胶囊。 */
export function DeviceGlyph(props: {
  device: DeviceKind;
  pulse?: boolean | undefined;
  status: ConnState;
}): ReactNode {
  const tone =
    props.status === "online"
      ? "online"
      : props.status === "connecting"
        ? "busy"
        : props.status === "offline"
          ? "offline"
          : "unknown";
  return (
    <span className="relative flex size-16 shrink-0 items-center justify-center rounded-3xl bg-secondary text-foreground/85">
      <Icon className="size-8" name={DEVICE_ICON[props.device]} />
      <span className="absolute right-1 bottom-1 flex size-3.5 items-center justify-center rounded-full bg-card">
        <StatusDot pulse={props.pulse} tone={tone} />
      </span>
    </span>
  );
}

export function SectionLabel(props: {
  children: ReactNode;
  trailing?: ReactNode;
}): ReactNode {
  return (
    <div className="flex min-h-9 items-center justify-between gap-2 px-1">
      <p className="font-medium text-[13px] text-muted-foreground leading-[18px]">
        {props.children}
      </p>
      {props.trailing}
    </div>
  );
}

export function StatusDot(props: {
  pulse?: boolean | undefined;
  tone: "online" | "offline" | "busy" | "unknown";
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block size-2 shrink-0 rounded-full",
        props.tone === "online" && "bg-success",
        props.tone === "busy" && "bg-warning",
        props.tone === "offline" && "bg-muted-foreground",
        props.tone === "unknown" && "bg-muted-foreground/60",
        props.pulse === true && "animate-pulse"
      )}
    />
  );
}

export type ConnState = HostStatus | "connecting";

const CONN_LABEL: Record<ConnState, string> = {
  connecting: "连接中",
  offline: "离线",
  online: "在线",
  unknown: "状态未知",
};

export function connLabel(state: ConnState): string {
  return CONN_LABEL[state];
}

const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  processing: "运行中",
  ready: "等待输入",
  waiting: "需要你处理",
};

export function sessionStatusBadge(session: DemoSession): ReactNode {
  if (session.kind === "terminal") {
    return null;
  }
  const variant =
    session.status === "waiting"
      ? "warning"
      : session.status === "processing"
        ? "info"
        : "neutral";
  return <Badge variant={variant}>{SESSION_STATUS_LABEL[session.status]}</Badge>;
}

export function sessionSubtitle(session: DemoSession): string {
  const agent = session.agent ?? "智能体";
  if (session.kind === "agent") {
    return session.worktree === session.title
      ? agent
      : `${agent} · ${session.worktree}`;
  }
  return session.worktree === session.title
    ? "终端"
    : `终端 · ${session.worktree}`;
}

export function InlineNote(props: {
  action?: ReactNode;
  children: ReactNode;
  tone: "warn" | "danger" | "info" | "ok";
}): ReactNode {
  return (
    <div
      className={cx(
        "flex items-start gap-3 rounded-xl border px-3.5 py-3 text-[13px] leading-[18px]",
        props.tone === "warn" &&
          "border-status-warning-border bg-status-warning-bg text-status-warning-fg",
        props.tone === "danger" &&
          "border-status-danger-border bg-status-danger-bg text-status-danger-fg",
        props.tone === "info" &&
          "border-status-info-border bg-status-info-bg text-status-info-fg",
        props.tone === "ok" &&
          "border-status-success-border bg-status-success-bg text-status-success-fg"
      )}
      role="status"
    >
      <span className="min-w-0 flex-1">{props.children}</span>
      {props.action}
    </div>
  );
}

export function EmptyState(props: {
  body: string;
  icon: IconName;
  title: string;
}): ReactNode {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <Icon className="size-7" name={props.icon} strokeWidth={1.5} />
      </span>
      <p className="font-medium text-[15px] leading-5">{props.title}</p>
      <p className="max-w-[260px] text-[13px] text-muted-foreground leading-[18px]">
        {props.body}
      </p>
    </div>
  );
}

export const TERMINAL_FONT_STEPS = [
  "text-[11px] leading-4",
  "text-[12px] leading-[18px]",
  "text-[13.5px] leading-5",
] as const;

export const DEFAULT_TERMINAL_FONT = 1;

const LINE_TONE: Record<NonNullable<ScreenLine["tone"]>, string> = {
  accent: "text-info",
  dim: "text-muted-foreground",
  ok: "text-success",
  prompt: "text-success",
  warn: "text-status-warning-fg",
};

/** 工作台 / 收件箱：把会话收成当前屏幕的一段切片，不是设置卡。 */
export function SessionSlice(props: {
  maxLines: number;
  onOpen: () => void;
  session: DemoSession;
  when?: string | undefined;
}): ReactNode {
  const waiting = props.session.status === "waiting";
  const lines = props.session.screen.slice(-props.maxLines);
  return (
    <button
      className={cx(
        "w-full text-left transition-colors duration-75 active:bg-interactive-active",
        waiting ? "border-status-warning-fg border-l-4" : "border-transparent border-l-4"
      )}
      onClick={props.onOpen}
      type="button"
    >
      <span className="flex items-baseline justify-between gap-3 px-4 pt-2.5 pb-1">
        <span className="truncate font-semibold text-[15px] leading-5">
          {props.session.title}
        </span>
        <span className="shrink-0 text-[12px] text-muted-foreground leading-4">
          {props.when ?? sessionSubtitle(props.session)}
        </span>
      </span>
      <pre className="m-0 overflow-hidden whitespace-pre px-4 pb-3 font-mono text-[12px] leading-[18px] text-foreground/85">
        {lines.map((line, index) => (
          <span
            className={line.tone === undefined ? undefined : LINE_TONE[line.tone]}
            key={`${index}-${line.text}`}
          >
            {line.text}
            {"\n"}
          </span>
        ))}
      </pre>
    </button>
  );
}

export function InstrumentChip(props: {
  hint?: ReactNode;
  icon?: IconName | undefined;
  label: string;
  onClick?: (() => void) | undefined;
}): ReactNode {
  return (
    <button
      className="flex h-11 shrink-0 items-center gap-2 rounded-lg px-2.5 text-[13px] leading-5 transition-colors duration-75 active:bg-interactive-active"
      onClick={props.onClick}
      type="button"
    >
      {props.icon === undefined ? null : (
        <Icon className="size-4 text-muted-foreground" name={props.icon} />
      )}
      <span className="truncate">{props.label}</span>
      {props.hint === undefined ? null : (
        <span className="font-mono text-[12px] tabular-nums">{props.hint}</span>
      )}
    </button>
  );
}

export function QuietEmpty(props: { body: string; title: string }): ReactNode {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pt-6">
      <p className="font-mono text-[13px] text-muted-foreground leading-[18px]">
        {props.title}
      </p>
      <p className="mt-1 max-w-[280px] text-[12px] text-muted-foreground/80 leading-[18px]">
        {props.body}
      </p>
      <span className="mt-6 inline-block h-[1.05em] w-[0.6em] animate-pulse bg-foreground/35" />
    </div>
  );
}

/** T1 读屏：只有当前屏幕的纯文本，等宽、顶对齐（像真终端视口）。 */
export function TerminalSurface(props: {
  className?: string | undefined;
  cursor?: boolean | undefined;
  fontIndex: number;
  lines: readonly ScreenLine[];
  onDoubleClick?: (() => void) | undefined;
}): ReactNode {
  const font =
    TERMINAL_FONT_STEPS[props.fontIndex] ??
    TERMINAL_FONT_STEPS[DEFAULT_TERMINAL_FONT];
  const lastText = props.lines[props.lines.length - 1]?.text ?? "";
  const showCursor = props.cursor === true && !lastText.includes("▌");
  return (
    <pre
      className={cx(
        "m-0 flex min-h-0 flex-1 flex-col justify-start overflow-hidden bg-transparent font-mono text-foreground/90",
        font,
        props.className
      )}
      onDoubleClick={props.onDoubleClick}
    >
      <span className="block whitespace-pre-wrap break-words">
        {props.lines.map((line, index) => (
          <span
            className={line.tone === undefined ? undefined : LINE_TONE[line.tone]}
            key={`${index}-${line.text}`}
          >
            {line.text}
            {showCursor && index === props.lines.length - 1 ? (
              <span className="ml-px inline-block h-[1.05em] w-[0.6em] translate-y-[0.18em] animate-pulse bg-foreground/70 align-baseline" />
            ) : null}
            {"\n"}
          </span>
        ))}
      </span>
    </pre>
  );
}

export function CaptionCard(props: {
  badge: string;
  children: ReactNode;
  title: string;
}): ReactNode {
  return (
    <div className="flex w-[420px] flex-col gap-2.5 rounded-md border border-border bg-muted/40 p-4">
      <CanvasRow gap={8}>
        <Badge variant="secondary">{props.badge}</Badge>
        <Text as="h3">{props.title}</Text>
      </CanvasRow>
      {props.children}
    </div>
  );
}
