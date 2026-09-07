import { type ReactNode, useState } from "react";
import { cx, type DemoTab, EmptyTileView, Group, ReviewView, Swatch, TabStrip, TaskPanelView, TerminalView, Tile, Window } from "./chrome.tsx";
import { Icon } from "./icons.tsx";
import { type DemoLine, type DemoWorktree, findWorktree, PROJECTS, RECENTS, workspaceCounts } from "./model.ts";
import { WorkspaceRail } from "./rail.tsx";

const LOGIN = findWorktree("pier-login");
const BILLING = findWorktree("pier-billing");
const NOTES = findWorktree("notes");
const MAIN = findWorktree("pier-main");
const RELAY = findWorktree("relay-main");
const COUNTS = workspaceCounts(PROJECTS);

interface DemoView {
  readonly id: string;
  readonly tab: DemoTab;
  readonly body: "review" | "empty" | { readonly lines: readonly DemoLine[] };
}

interface DemoGroup {
  readonly views: readonly DemoView[];
}

interface DemoTileLayout {
  readonly worktree: DemoWorktree;
  readonly groups: readonly DemoGroup[];
}

function sessionView(tree: DemoWorktree): DemoView {
  const session = tree.sessions[0];
  return {
    body: { lines: session?.lines ?? [] },
    id: `${tree.id}:session`,
    tab: { active: true, label: session?.title ?? tree.name, provider: session?.provider, state: session?.state },
  };
}

const REVIEW_FILES = [
  { add: 22, del: 9, path: "src/auth/session.ts" },
  { add: 15, del: 2, path: "src/auth/retry.ts" },
  { add: 31, del: 0, path: "src/auth/session.test.ts" },
];

const LAYOUTS: Record<string, DemoTileLayout> = {
  notes: { groups: [{ views: [sessionView(NOTES)] }], worktree: NOTES },
  "pier-billing": {
    groups: [
      {
        views: [sessionView(BILLING), { body: { lines: [] }, id: "pier-billing:invoice", tab: { icon: "file", label: "invoice.ts" } }],
      },
    ],
    worktree: BILLING,
  },
  "pier-login": {
    groups: [
      { views: [sessionView(LOGIN)] },
      { views: [{ body: "review", id: "pier-login:review", tab: { active: true, icon: "git", label: "更改" } }] },
    ],
    worktree: LOGIN,
  },
  "pier-main": { groups: [{ views: [sessionView(MAIN)] }], worktree: MAIN },
  "relay-main": { groups: [{ views: [{ body: "empty", id: "relay:empty", tab: { active: true, label: "relay" } }] }], worktree: RELAY },
};

function layoutOf(id: string): DemoTileLayout {
  const layout = LAYOUTS[id];
  if (!layout) {
    throw new Error(`demo layout missing: ${id}`);
  }
  return layout;
}

function groupBody(active: DemoView | undefined): ReactNode {
  if (!active || active.body === "empty") {
    return null;
  }
  if (active.body === "review") {
    return <ReviewView files={REVIEW_FILES} />;
  }
  return <TerminalView lines={active.body.lines} />;
}

function PaneTree(props: { readonly destination?: string | null; readonly focused: boolean; readonly layout: DemoTileLayout }): ReactNode {
  if (props.destination === "pier.tasks.board") {
    return (
      <Group header={<TabStrip focused={props.focused} tabs={[{ active: true, icon: "kanban", label: "任务跟踪" }]} />}>
        <TaskPanelView />
      </Group>
    );
  }
  const first = props.layout.groups[0];
  const firstView = first?.views.find((view) => view.tab.active) ?? first?.views[0];
  if (firstView?.body === "empty") {
    return <EmptyTileView worktree={props.layout.worktree} />;
  }
  return (
    <div className="grid min-h-0 flex-1 gap-px bg-border" style={{ gridTemplateColumns: `repeat(${props.layout.groups.length}, minmax(0, 1fr))` }}>
      {props.layout.groups.map((group, index) => {
        const active = group.views.find((view) => view.tab.active) ?? group.views[0];
        return (
          <Group header={<TabStrip focused={props.focused && index === 0} tabs={group.views.map((view) => view.tab)} />} key={`${props.layout.worktree.id}-${index}`}>
            {groupBody(active)}
          </Group>
        );
      })}
    </div>
  );
}

const MAIN_WINDOW_NAME = "pier-login";

export function MainWindowBoard(props: { readonly interactive?: boolean }): ReactNode {
  const interactive = props.interactive ?? true;
  const [visibleId, setVisibleId] = useState("pier-login");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [locateHint, setLocateHint] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [destination, setDestination] = useState<string | null>(null);
  const layout = layoutOf(visibleId);
  const hoverTarget = hoverId && hoverId !== visibleId && !destination ? findWorktree(hoverId) : null;
  return (
    <Window
      counts={COUNTS}
      kind="main"
      onToggleRail={interactive ? () => setRailCollapsed((value) => !value) : undefined}
      rail={
        <WorkspaceRail
          expandedWorktreeIds={[visibleId, "relay-main"]}
          onHoverWorktree={interactive ? setHoverId : undefined}
          onLocateSession={
            interactive
              ? (session) => {
                  setLocateHint(session.window ? `将激活窗口 ${session.window}` : null);
                }
              : undefined
          }
          onOpenDestination={
            interactive
              ? (id) => {
                  setLocateHint(null);
                  setDestination(id);
                }
              : undefined
          }
          onSelectWorktree={
            interactive
              ? (id) => {
                  setLocateHint(null);
                  setDestination(null);
                  setVisibleId(id);
                }
              : undefined
          }
          projects={PROJECTS}
          selectedDestinationId={destination ?? undefined}
          selectedWorktreeId={visibleId}
        />
      }
      railCollapsed={railCollapsed}
      windowName={MAIN_WINDOW_NAME}
    >
      <Tile
        focused
        highlighted={hoverId === visibleId}
        overlay={
          locateHint ? (
            <div className="pointer-events-none absolute bottom-9 left-2 inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-[12px] shadow-md">
              {locateHint}
            </div>
          ) : hoverTarget ? (
            <div className="pointer-events-none absolute bottom-9 left-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12px] shadow-md">
              <span className="text-muted-foreground">点击切换到</span>
              <Swatch identity={hoverTarget.identity} size={9} />
              <span className="font-medium">{hoverTarget.name}</span>
            </div>
          ) : null
        }
        worktree={layout.worktree}
      >
        <PaneTree destination={destination} focused layout={layout} />
      </Tile>
    </Window>
  );
}

export function SubWindowBoard(): ReactNode {
  const [focusedId, setFocusedId] = useState("pier-billing");
  const tiles = ["pier-login", "pier-billing", "notes", "pier-main"].map(layoutOf);
  return (
    <Window counts={COUNTS} hiddenTiles={1} kind="sub" windowName="pier-login · +3">
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1 bg-surface-canvas p-1">
        {tiles.map((layout) => (
          <Tile
            focused={focusedId === layout.worktree.id}
            key={layout.worktree.id}
            loading={layout.worktree.id === "pier-main"}
            onActivate={() => setFocusedId(layout.worktree.id)}
            worktree={layout.worktree}
          >
            <PaneTree focused={focusedId === layout.worktree.id} layout={layout} />
          </Tile>
        ))}
      </div>
    </Window>
  );
}

function GhostTab(props: { readonly className?: string }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={cx("pointer-events-none absolute z-10 inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[12px] shadow-md", props.className)}
    >
      <Swatch identity={LOGIN.identity} size={8} />
      登录超时
      <Icon className="size-3.5 text-status-warning-fg" name="pause" />
    </span>
  );
}

function MiniTile(props: { readonly children?: ReactNode; readonly className?: string; readonly overlay?: ReactNode; readonly worktree: DemoWorktree }): ReactNode {
  return (
    <div className={cx("relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background", props.className)}>
      <div className="h-7 shrink-0 border-border border-b bg-sidebar" />
      <div className="relative min-h-0 flex-1">{props.children}</div>
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-border border-t bg-background px-2 text-[12px]">
        <Swatch identity={props.worktree.identity} size={9} />
        <span className="font-medium">{props.worktree.name}</span>
        {props.worktree.branch ? <span className="font-mono text-[11px] text-muted-foreground">{props.worktree.branch}</span> : null}
      </div>
      {props.overlay}
    </div>
  );
}

function MiniRail(props: { readonly dragging?: boolean }): ReactNode {
  return (
    <div className="flex w-24 shrink-0 flex-col gap-px border-sidebar-border border-r bg-sidebar p-1.5 text-[11px]">
      {[LOGIN, BILLING, NOTES].map((tree) => (
        <div className={cx("relative flex h-6 items-center gap-1.5 rounded px-1", tree.id === "pier-billing" && !props.dragging && "bg-sidebar-accent")} key={tree.id}>
          <Swatch identity={tree.identity} size={8} />
          <span className="truncate">{tree.name}</span>
        </div>
      ))}
    </div>
  );
}

function MiniWindow(props: { readonly children: ReactNode; readonly rail?: ReactNode; readonly title: string }): ReactNode {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-border bg-background">
      <div className="relative flex h-7 shrink-0 items-center border-border border-b bg-sidebar pl-2">
        <span aria-hidden="true" className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground/25" />
          <span className="size-2 rounded-full bg-muted-foreground/25" />
          <span className="size-2 rounded-full bg-muted-foreground/25" />
        </span>
        <span className="absolute inset-x-0 text-center text-[11px] text-muted-foreground">{props.title}</span>
      </div>
      <div className="flex min-h-0 flex-1">
        {props.rail}
        <div className="flex min-h-0 min-w-0 flex-1 gap-1 bg-surface-canvas p-1">{props.children}</div>
      </div>
    </div>
  );
}

function Zone(props: { readonly children: ReactNode; readonly className?: string; readonly tone: "accept" | "create" | "reject" }): ReactNode {
  return (
    <div
      className={cx(
        "absolute flex items-center justify-center rounded-md border text-center text-[11px] leading-4",
        props.tone === "accept" && "border-primary/60 bg-primary/10 text-foreground",
        props.tone === "create" && "border-primary/60 border-dashed bg-primary/5 text-foreground",
        props.tone === "reject" && "border-border bg-surface-inset/70 text-muted-foreground",
        props.className
      )}
    >
      <span className="px-2">{props.children}</span>
    </div>
  );
}

function Caption(props: { readonly body: string; readonly title: string }): ReactNode {
  return (
    <div className="text-[12px] leading-5">
      <span className="font-medium">{props.title}</span>
      <span className="text-muted-foreground"> {props.body}</span>
    </div>
  );
}

export function DropRulesBoard(): ReactNode {
  return (
    <div className="flex h-full flex-col gap-4 bg-surface-canvas p-6 text-foreground antialiased">
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-5">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-1">
            <MiniWindow rail={<MiniRail />} title="pier-login（主窗口，1 个区域）">
              <MiniTile className="flex-1" worktree={BILLING}>
                <Zone className="inset-y-3 right-3 left-20" tone="accept">
                  隐藏集已有 pier-login → 恢复它（pier-billing 回到隐藏集）；松开即落入
                </Zone>
                <Zone className="inset-y-3 left-3 w-14" tone="create">
                  边缘 → 新建 pier-login 的区域
                </Zone>
                <GhostTab className="top-10 left-28" />
              </MiniTile>
            </MiniWindow>
          </div>
          <Caption body="窗口名是锚 pier-login，可见区是 pier-billing。隐藏集已有同工作树区域就恢复，不弹簧造第二个。" title="单区域窗口：已有则恢复，没有才替换。" />
        </div>
        <div className="flex min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-1">
            <MiniWindow title="pier-billing · +1（子窗口，2 个区域）">
              <MiniTile className="flex-1" worktree={BILLING}>
                <Zone className="inset-x-3 top-3 bottom-0" tone="accept">
                  停住 0.5s → 这块区域切换为 pier-login（pier-billing 进隐藏集）
                </Zone>
                <GhostTab className="top-10 left-8" />
              </MiniTile>
              <MiniTile className="flex-1" worktree={NOTES}>
                <Zone className="top-3 right-3 bottom-3 w-16" tone="create">
                  边缘 → 新建 pier-login 的区域
                </Zone>
              </MiniTile>
            </MiniWindow>
          </div>
          <Caption body="和单区域窗口完全一样的两种落点；被替换的区域不丢，进「+ 工作树」的隐藏集。" title="多区域窗口、没有同工作树区域：同一套规则。" />
        </div>
        <div className="flex min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-1">
            <MiniWindow title="pier-login · +1（子窗口，已有同工作树区域）">
              <MiniTile className="flex-1" worktree={LOGIN}>
                <Zone className="inset-3" tone="accept">
                  唯一落点：落入 pier-login 的 pane 树（普通 dockview 落点）
                </Zone>
                <GhostTab className="top-10 left-8" />
              </MiniTile>
              <MiniTile className="flex-1" worktree={NOTES}>
                <Zone className="inset-3" tone="reject">
                  拒绝：「pier-login 在本窗口已有区域」
                </Zone>
              </MiniTile>
            </MiniWindow>
          </div>
          <Caption body="同一窗口内同一工作树至多一个区域（R12）；同窗把 tab 拖到别的区域也是这条：一律拒绝并高亮已有区域。tab 不能落到侧栏。" title="目标窗口已有同工作树区域：它是唯一落点。" />
        </div>
        <div className="flex min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-1">
            <MiniWindow rail={<MiniRail dragging />} title="拖区域 / 拖侧栏行（任何窗口）">
              <MiniTile className="flex-1" worktree={BILLING}>
                <Zone className="inset-x-3 top-3 bottom-3" tone="create">
                  侧栏行「notes」拖到这里 → 在落点新建 notes 的区域
                  <br />
                  拖区域状态栏 → 换位 / 分屏 / 移到别的窗口 / 移到新窗口
                </Zone>
                <span aria-hidden="true" className="pointer-events-none absolute top-8 left-6 z-10 inline-flex h-6 items-center gap-1.5 rounded border border-border bg-background px-2 text-[11px] shadow-md">
                  <Swatch identity={NOTES.identity} size={8} />
                  notes
                </span>
              </MiniTile>
            </MiniWindow>
          </div>
          <Caption body="落到已有同工作树区域即合并（R12）。" title="区域与侧栏行可以落到任何窗口。" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-x-5 gap-y-1 rounded-md border border-border bg-background p-3 text-[12px] leading-5">
        <span className="col-span-4 font-medium">§9.2 全表（与区域数量无关）</span>
        <span>tab → 同区域：dockview 现有语义</span>
        <span>tab → 同窗其他区域：一律拒绝，高亮已有区域</span>
        <span>tab → 另一窗有同工作树区域（含隐藏）：恢复并作为唯一落点</span>
        <span>tab → 另一窗任一区域停住：弹簧替换，被替换的进隐藏集</span>
        <span>tab → 另一窗区域边缘：新建区域</span>
        <span>tab → 桌面：移到新窗口</span>
        <span>tab → 侧栏：拒绝</span>
        <span>分组拖动 = 同工作树 tab 集合，按 tab 规则</span>
        <span>区域 → 同窗：换位 / 分屏</span>
        <span>区域 → 另一窗：整块移动；同工作树则合并</span>
        <span>区域 → 桌面：移到新窗口</span>
        <span>侧栏行 → 任何窗口：新建 / 高亮已有区域</span>
      </div>
    </div>
  );
}

export function FirstRunBoard(): ReactNode {
  const pendingTree: DemoWorktree = { id: "pier-hotfix", identity: 5, name: "pier-hotfix", branch: "hotfix/2fa", sessions: [] };
  return (
    <div className="grid h-full grid-cols-2 gap-6 bg-surface-canvas p-6 text-foreground antialiased">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
          <Window counts={{ needsYou: 0, running: 0 }} kind="main" rail={<WorkspaceRail projects={[]} recents={RECENTS} />} windowName="~">
            <Tile focused pendingName="~" worktree={null}>
              <Group header={<TabStrip focused tabs={[{ active: true, label: "~", provider: "shell" }]} />}>
                <TerminalView lines={[{ kind: "prompt", text: "❯ █" }]} />
              </Group>
            </Tile>
          </Window>
        </div>
        <Caption body="侧栏空态 + 最近 + 打开项目；窗口名就是 `~`；窗口里就是一个能敲的终端（`~` 退化单元：状态栏空框、无分支）。`cd` 进已打开项目的工作树后区域原地重绑（§7.3）；打开项目后这个只含空闲终端的 `~` 区域自动关闭。" title="首启 / 无项目（§8）。" />
      </div>
      <div className="flex min-h-0 flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
          <Window
            counts={COUNTS}
            kind="main"
            rail={
              <WorkspaceRail
                expandedWorktreeIds={[]}
                loading
                pending={{ phase: "失败 · 点击重试", projectId: "pier", worktree: pendingTree }}
                projects={PROJECTS}
                selectedWorktreeId="pier-billing"
              />
            }
            windowName="pier-login"
          >
            <Tile focused loading worktree={BILLING}>
              <Group header={<TabStrip focused tabs={[{ active: true, label: "账单税率", provider: "Claude", state: "running" }]} />}>
                <TerminalView lines={BILLING.sessions[0]?.lines ?? []} />
              </Group>
            </Tile>
          </Window>
        </div>
        <Caption
          body="侧栏页头底缘滑块 = 异步源未到齐；待建行失败原位变成「失败 · 点击重试」（创建中时是行底滑块 + 阶段文字）；区域状态栏顶缘滑块 = 该工作树的 git 事实在读取（分支 / ±N 槽位留空）；tab 顶缘滑块 = 会话运行中。全部是同一条不定长滑块，没有 Spinner。"
          title="加载与后台操作（R6）。"
        />
      </div>
    </div>
  );
}

