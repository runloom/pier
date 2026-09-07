import { Button, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "pier/canvas";
import type { ReactNode } from "react";
import { ProviderGlyph } from "./brands.tsx";
import { Icon } from "./icons.tsx";
import {
  type AggregateState,
  type DemoLine,
  type DemoWorktree,
  type IdentityId,
  identityColor,
  type SessionState,
  STATE_META,
  worktreeState,
} from "./model.ts";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

/** 几何沿用产品现值：标题栏 38 / tab 条 34 / 状态栏 28（状态栏内项 22 = `Button size="status-bar"`）/ 侧栏 240。 */
export const TITLE_BAR_H = 38;
export const TAB_STRIP_H = 34;
export const TILE_STATUS_H = 28;
export const RAIL_W = 240;

/** 实心方块身份（R5）；未解析时同形空框占位。 */
export function Swatch(props: { readonly identity: IdentityId | undefined; readonly size?: number }): ReactNode {
  const size = props.size ?? 10;
  if (props.identity === undefined) {
    return <span aria-hidden="true" className="inline-block shrink-0 rounded-[3px] border border-border" style={{ height: size, width: size }} />;
  }
  return (
    <span aria-hidden="true" className="inline-block shrink-0 rounded-[3px]" style={{ background: identityColor(props.identity), height: size, width: size }} />
  );
}

export function StateDot(props: { readonly className?: string; readonly state: AggregateState }): ReactNode {
  return (
    <span
      aria-label={STATE_META[props.state].label}
      className={cx("inline-block size-2 shrink-0 rounded-full", STATE_META[props.state].dot, props.className)}
      role="img"
      title={STATE_META[props.state].label}
    />
  );
}

/** 加载 / 运行的唯一运动：不定长滑块的静态快照。 */
export function Slider(props: { readonly edge?: "bottom" | "top"; readonly tier: "s1" | "s2" | "s3" }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "pointer-events-none absolute inset-x-0 block overflow-hidden",
        props.edge === "bottom" ? "bottom-0" : "top-0",
        props.tier === "s1" ? "h-px" : "h-0.5",
        props.tier === "s3" ? "bg-primary/40" : "bg-muted-foreground/45"
      )}
    >
      <span className={cx("absolute inset-y-0 left-[38%] w-[34%]", props.tier === "s3" ? "bg-primary" : "bg-muted-foreground")} />
    </span>
  );
}

export { ProviderGlyph };

export interface WorkspaceCounts {
  readonly needsYou: number;
  readonly running: number;
}

/** 窗口名来自锚 tile；聚合计数为 0 留空。红绿灯只占位。 */
export function TitleBar(props: {
  readonly counts: WorkspaceCounts;
  readonly hiddenTiles?: number;
  readonly kind: "main" | "sub";
  readonly onToggleRail?: (() => void) | undefined;
  readonly railCollapsed?: boolean;
  readonly windowName: string;
}): ReactNode {
  const hasCounts = props.counts.running > 0 || props.counts.needsYou > 0;
  return (
    <div className="relative flex shrink-0 items-center border-sidebar-border border-b bg-sidebar" style={{ height: TITLE_BAR_H }}>
      <span aria-hidden="true" className="flex items-center gap-2 pl-3">
        <span className="size-3 rounded-full bg-muted-foreground/25" />
        <span className="size-3 rounded-full bg-muted-foreground/25" />
        <span className="size-3 rounded-full bg-muted-foreground/25" />
      </span>
      {props.kind === "main" ? (
        <Button
          aria-label={props.railCollapsed ? "展开侧栏" : "折叠侧栏"}
          aria-pressed={!props.railCollapsed}
          className="ml-3"
          onClick={props.onToggleRail}
          size="icon"
          title="侧栏 ⌘B"
          type="button"
          variant="ghost"
        >
          <Icon className="size-4" data-icon="" name="sidebar" />
        </Button>
      ) : (
        <Button aria-label="添加工作树到此窗口" className="ml-3 text-muted-foreground" size="sm" type="button" variant="ghost">
          <Icon className="size-3.5" data-icon="" name="plus" />
          工作树
          {props.hiddenTiles ? <span className="text-muted-foreground/80">· {props.hiddenTiles} 已隐藏</span> : null}
        </Button>
      )}
      <div className="pointer-events-none absolute inset-x-0 flex items-center justify-center px-56 text-[12px]">
        <span className="truncate font-medium text-muted-foreground">{props.windowName}</span>
      </div>
      <div className="absolute right-3 flex items-center gap-1">
        {hasCounts ? (
          <Button
            aria-label={`智能体：${props.counts.running} 个运行中，${props.counts.needsYou} 个需要你处理`}
            className="rounded-full"
            size="sm"
            type="button"
            variant="outline"
          >
            {props.counts.running > 0 ? (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <StateDot state="running" />
                {props.counts.running}
              </span>
            ) : null}
            {props.counts.needsYou > 0 ? (
              <span className="inline-flex items-center gap-1 font-medium text-status-warning-fg tabular-nums">
                <StateDot state="needsYou" />
                {props.counts.needsYou}
              </span>
            ) : null}
          </Button>
        ) : null}
        <Button aria-label="消息" size="icon" type="button" variant="ghost">
          <Icon className="size-4" data-icon="" name="bell" />
        </Button>
        {props.kind === "main" ? (
          <Button aria-label="检查更新" size="icon" type="button" variant="ghost">
            <Icon className="size-4" data-icon="" name="refresh" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** 只读事实槽：保宽、不进 Tab 序。 */
function StatusFact(props: { readonly children?: ReactNode; readonly className?: string; readonly minWidth?: number }): ReactNode {
  return (
    <span
      className={cx("inline-flex h-[22px] items-center gap-1 rounded px-1.5 text-[12px] text-muted-foreground", props.className)}
      style={props.minWidth === undefined ? undefined : { minWidth: props.minWidth }}
    >
      {props.children}
    </span>
  );
}

/** 可点事实槽：有值才是按钮，空则占位。 */
function StatusAction(props: { readonly children: ReactNode; readonly label: string; readonly minWidth: number; readonly muted?: boolean }): ReactNode {
  return (
    <Button
      aria-label={props.label}
      className={cx("justify-start px-1.5 font-mono text-[12px] tabular-nums", props.muted ? "text-muted-foreground" : "text-foreground")}
      size="status-bar"
      style={{ minWidth: props.minWidth }}
      type="button"
      variant="ghost"
    >
      {props.children}
    </Button>
  );
}

/** 工作树事实栏：槽位恒定，值空留空；未聚焦只弱化事实不弱化名字。 */
export function TileStatusBar(props: {
  readonly focused: boolean;
  readonly highlighted?: boolean;
  readonly loading?: boolean;
  readonly pendingName?: string | undefined;
  readonly worktree: DemoWorktree | null;
}): ReactNode {
  const tree = props.worktree;
  const state = tree ? worktreeState(tree) : undefined;
  const sync = tree?.ahead || tree?.behind;
  return (
    <div
      className="relative flex shrink-0 items-center gap-0.5 border-border border-t bg-background pr-1 pl-1.5"
      data-testid={tree ? `tile-status-${tree.id}` : "tile-status-pending"}
      style={{ height: TILE_STATUS_H }}
    >
      {props.loading ? <Slider edge="top" tier={props.focused ? "s3" : "s2"} /> : null}
      <StatusFact className={cx("text-foreground", props.highlighted && "bg-interactive-hover")}>
        <Swatch identity={tree?.identity} size={10} />
        <span className="font-medium">{tree?.name ?? props.pendingName ?? "…"}</span>
      </StatusFact>
      <span className="flex w-4 shrink-0 items-center justify-center">{state ? <StateDot state={state} /> : null}</span>
      <StatusFact className={cx(props.focused ? "text-muted-foreground" : "text-muted-foreground/60")} minWidth={88}>
        {!props.loading && tree?.branch ? (
          <>
            <Icon className="size-3.5" name="branch" />
            <span className="truncate font-mono">{tree.branch}</span>
          </>
        ) : null}
      </StatusFact>
      {!props.loading && tree?.changes ? (
        <StatusAction label={`查看 ${tree.name} 的更改`} minWidth={56} muted={!props.focused}>
          <Icon className="size-3.5" data-icon="" name="git" />±{tree.changes}
        </StatusAction>
      ) : (
        <StatusFact minWidth={56} />
      )}
      {!props.loading && sync && tree ? (
        <StatusAction label={`同步 ${tree.name}`} minWidth={56} muted={!props.focused}>
          {tree.ahead ? <span>↑{tree.ahead}</span> : null}
          {tree.behind ? <span>↓{tree.behind}</span> : null}
        </StatusAction>
      ) : (
        <StatusFact minWidth={56} />
      )}
      <span className="ml-auto flex items-center">
        <Button aria-label={`${tree?.name ?? "此区域"} 的更多动作`} size="status-bar" type="button" variant="ghost">
          <Icon className="size-3.5" data-icon="" name="dots" />
        </Button>
      </span>
    </div>
  );
}

export interface DemoTab {
  readonly active?: boolean;
  readonly icon?: "file" | "git" | "kanban" | "terminal";
  readonly label: string;
  readonly provider?: string | undefined;
  readonly state?: SessionState | undefined;
}

/** 分组 tab：选中顶缘线 / 运行滑块 / 需要处理图标；不带工作树事实。 */
export function TabStrip(props: { readonly focused: boolean; readonly tabs: readonly DemoTab[] }): ReactNode {
  const tier = props.focused ? "s3" : "s2";
  return (
    <div className="relative flex shrink-0 items-stretch border-border border-b bg-sidebar" style={{ height: TAB_STRIP_H }}>
      <div className="flex min-w-0 flex-1 items-stretch">
        {props.tabs.map((tab, index) => {
          const prev = props.tabs[index - 1];
          const separator = index > 0 && !tab.active && !prev?.active;
          return (
            <span
              className={cx(
                "relative inline-flex max-w-52 items-center gap-1.5 pr-1.5 pl-3 text-[12px]",
                tab.active ? "bg-background text-foreground" : "text-muted-foreground"
              )}
              key={tab.label}
            >
              {separator ? <span aria-hidden="true" className="absolute top-1/2 left-0 h-3.5 w-px -translate-y-1/2 bg-foreground/14" /> : null}
              {tab.state === "running" ? (
                <Slider tier={tab.active ? tier : "s1"} />
              ) : tab.active ? (
                <span aria-hidden="true" className={cx("absolute inset-x-0 top-0 h-0.5", props.focused ? "bg-primary" : "bg-muted-foreground")} />
              ) : null}
              {tab.provider ? <ProviderGlyph provider={tab.provider} /> : tab.icon ? <Icon className="size-3.5 opacity-70" name={tab.icon} /> : null}
              <span className={cx("truncate", tab.state === "doneUnseen" && "font-semibold")}>{tab.label}</span>
              {tab.state === "needsYou" ? (
                <span aria-label="需要你处理" className="flex size-4 items-center justify-center text-status-warning-fg" role="img" title="需要你处理">
                  <Icon className="size-3.5" name="pause" />
                </span>
              ) : null}
              <span className="ml-0.5 flex size-[18px] items-center justify-center text-muted-foreground/60">
                {tab.active ? <Icon className="size-3" name="x" /> : null}
              </span>
            </span>
          );
        })}
        <Button aria-label="在此分组新建" className="ml-0.5 h-full rounded-none text-muted-foreground" size="icon" type="button" variant="ghost">
          <Icon className="size-3.5" data-icon="" name="plus" />
        </Button>
      </div>
      <Button aria-label="最大化分组" className="h-full rounded-none text-muted-foreground" size="icon" type="button" variant="ghost">
        <Icon className="size-3.5" data-icon="" name="maximize" />
      </Button>
    </div>
  );
}

export function TerminalView(props: { readonly lines: readonly DemoLine[] }): ReactNode {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden bg-background px-3 py-2.5 font-mono text-[12px] leading-[18px]">
      {props.lines.map((line, index) => (
        <div
          className={cx(
            "whitespace-pre-wrap",
            line.kind === "prompt" && "text-foreground/80",
            line.kind === "agent" && "text-foreground",
            line.kind === "out" && "text-muted-foreground",
            line.kind === "input" && "mt-auto rounded-md border border-border bg-surface-canvas px-2 py-1.5 text-muted-foreground"
          )}
          key={`${index}-${line.text}`}
        >
          {line.text}
        </div>
      ))}
    </div>
  );
}

/** 定位到没有视图的工作树：不自动建进程。 */
export function EmptyTileView(props: { readonly worktree: DemoWorktree }): ReactNode {
  return (
    <Empty className="flex-1 bg-background">
      <EmptyHeader>
        <EmptyTitle>{props.worktree.name} 还没有打开任何视图</EmptyTitle>
        <EmptyDescription>点侧栏里的会话可以跳到它所在的窗口。也可以在这里新开终端或智能体。</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex items-center gap-2">
          <Button size="sm" type="button" variant="outline">
            <Icon className="size-3.5" data-icon="" name="terminal" />
            新建终端
          </Button>
          <Button size="sm" type="button">
            启动智能体…
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}

/** 已有任务跟踪面板的紧缩示意，不是侧栏议题树。 */
export function TaskPanelView(): ReactNode {
  const issues = [
    { id: "#412", title: "登录超时后未清 cookie" },
    { id: "#388", title: "税率按地区解析" },
    { id: "#201", title: "relay 连接数指标" },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-px bg-background px-2 py-2">
      {issues.map((issue) => (
        <div className="flex h-7 items-center gap-2 rounded-md px-2 text-[12px]" key={issue.id}>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{issue.id}</span>
          <span className="truncate">{issue.title}</span>
        </div>
      ))}
    </div>
  );
}

export function ReviewView(props: { readonly files: readonly { readonly add: number; readonly del: number; readonly path: string }[] }): ReactNode {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-border border-b px-2 text-[12px]">
        <Button size="sm" type="button" variant="outline">
          未提交
          <Icon className="size-3" data-icon="" name="chevron-down" />
        </Button>
        <Button className="text-muted-foreground" size="sm" type="button" variant="ghost">
          拆分
          <Icon className="size-3" data-icon="" name="chevron-down" />
        </Button>
        <Button className="ml-auto" size="sm" type="button">
          <Icon className="size-3.5" data-icon="" name="send" />
          发送给智能体 · 1
        </Button>
        <Button size="sm" type="button" variant="outline">
          提交…
        </Button>
      </div>
      <div className="flex flex-col gap-px px-2 py-2 text-[12px]">
        {props.files.map((file) => (
          <div className="flex h-7 items-center gap-2 rounded-md px-2" key={file.path}>
            <Icon className="size-3.5 text-muted-foreground" name="file" />
            <span className="truncate">{file.path}</span>
            <span className="ml-auto font-mono text-[11px] tabular-nums">
              <span className="text-status-success-fg">+{file.add}</span> <span className="text-status-danger-fg">−{file.del}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Group(props: { readonly children: ReactNode; readonly header: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      {props.header}
      <div className="flex min-h-0 flex-1 flex-col">{props.children}</div>
    </div>
  );
}

/** 工作树 × 窗口：pane 树 + 底部状态栏。聚焦只靠 tab 顶缘线。 */
export function Tile(props: {
  readonly children: ReactNode;
  readonly focused: boolean;
  readonly highlighted?: boolean;
  readonly loading?: boolean;
  readonly onActivate?: (() => void) | undefined;
  readonly overlay?: ReactNode;
  readonly pendingName?: string | undefined;
  readonly worktree: DemoWorktree | null;
}): ReactNode {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 点击正文只是把焦点交给区域，等价于点进 dockview 内容；键盘路径由内部控件承担。
    <div
      aria-label={props.worktree ? `${props.worktree.name} 的区域` : "尚未识别工作树的区域"}
      className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      data-testid={props.worktree ? `tile-${props.worktree.id}` : "tile-pending"}
      onClick={props.onActivate}
      role="group"
    >
      <div className="flex min-h-0 flex-1 flex-col">{props.children}</div>
      <TileStatusBar
        focused={props.focused}
        highlighted={props.highlighted}
        loading={props.loading}
        pendingName={props.pendingName}
        worktree={props.worktree}
      />
      {props.overlay}
    </div>
  );
}

export function Window(props: {
  readonly children: ReactNode;
  readonly counts: WorkspaceCounts;
  readonly hiddenTiles?: number;
  readonly kind: "main" | "sub";
  readonly onToggleRail?: (() => void) | undefined;
  readonly rail?: ReactNode;
  readonly railCollapsed?: boolean;
  readonly windowName: string;
}): ReactNode {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-[12px] text-foreground antialiased">
      <TitleBar
        counts={props.counts}
        hiddenTiles={props.hiddenTiles ?? 0}
        kind={props.kind}
        onToggleRail={props.onToggleRail}
        railCollapsed={props.railCollapsed ?? false}
        windowName={props.windowName}
      />
      <div className="flex min-h-0 flex-1">
        {props.kind === "main" && !props.railCollapsed ? props.rail : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-canvas">{props.children}</div>
      </div>
    </div>
  );
}
