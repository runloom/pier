import { Button } from "pier/canvas";
import type { ReactNode } from "react";
import { cx, ProviderGlyph, RAIL_W, Slider, StateDot, Swatch, TILE_STATUS_H } from "./chrome.tsx";
import { Icon } from "./icons.tsx";
import {
  type DemoDestination,
  type DemoProject,
  type DemoSession,
  type DemoWorktree,
  projectState,
  SIDEBAR_DESTINATIONS,
  STATE_META,
  worktreeState,
  worktreeUnseen,
} from "./model.ts";

const ROW =
  "flex h-7 w-full items-center gap-2 rounded-md text-left text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-inset";

function ProjectRow(props: { readonly collapsed?: boolean; readonly project: DemoProject }): ReactNode {
  const state = props.collapsed ? projectState(props.project) : undefined;
  return (
    <div className="flex items-center gap-0.5 pr-1">
      <button
        aria-expanded={!props.collapsed}
        aria-label={`${props.collapsed ? "展开" : "折叠"} ${props.project.name}`}
        className={cx(ROW, "min-w-0 flex-1 pl-1.5 text-foreground hover:bg-interactive-hover")}
        type="button"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" name={props.collapsed ? "chevron-right" : "chevron-down"} />
        <span className="truncate font-medium">{props.project.name}</span>
        {state ? <StateDot className="ml-auto" state={state} /> : null}
      </button>
      <Button aria-label={`在 ${props.project.name} 中新建工作树`} className="text-muted-foreground/70" size="icon-xs" type="button" variant="ghost">
        <Icon className="size-3.5" data-icon="" name="plus" />
      </Button>
    </div>
  );
}

function SessionRow(props: {
  readonly onLocate?: ((session: DemoSession) => void) | undefined;
  readonly session: DemoSession;
}): ReactNode {
  const { session } = props;
  const dot = session.state === "needsYou" || session.state === "running" ? session.state : undefined;
  return (
    <button
      aria-label={`定位 ${session.title}`}
      className={cx(ROW, "pr-2.5 pl-8 text-muted-foreground hover:bg-interactive-hover")}
      onClick={() => props.onLocate?.(session)}
      title={STATE_META[session.state].label}
      type="button"
    >
      <ProviderGlyph provider={session.provider} />
      <span className={cx("truncate text-foreground", session.state === "doneUnseen" && "font-semibold")}>{session.title}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {session.window ? <span className="rounded bg-surface-raised px-1 text-[11px] leading-[16px]">{session.window}</span> : null}
        {dot ? <StateDot state={dot} /> : null}
      </span>
    </button>
  );
}

function DestinationRow(props: {
  readonly destination: DemoDestination;
  readonly onOpen?: ((id: string) => void) | undefined;
  readonly selected: boolean;
}): ReactNode {
  return (
    <button
      aria-current={props.selected ? "page" : undefined}
      aria-label={`打开 ${props.destination.title}`}
      className={cx(
        ROW,
        "px-1.5",
        props.selected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-interactive-hover"
      )}
      onClick={() => props.onOpen?.(props.destination.id)}
      type="button"
    >
      <Icon className="size-3.5 shrink-0" name="kanban" />
      <span className="truncate text-foreground">{props.destination.title}</span>
    </button>
  );
}

function WorktreeRow(props: {
  readonly expanded: boolean;
  readonly onHover?: ((id: string | null) => void) | undefined;
  readonly onLocateSession?: ((session: DemoSession) => void) | undefined;
  readonly onSelect?: ((id: string) => void) | undefined;
  readonly pending?: string;
  readonly selected: boolean;
  readonly worktree: DemoWorktree;
}): ReactNode {
  const { worktree } = props;
  const state = worktreeState(worktree);
  const unseen = worktreeUnseen(worktree);
  const quiet = worktree.sessions.length === 0 && !worktree.changes;
  return (
    <div>
      <button
        aria-current={props.selected ? "true" : undefined}
        aria-label={`切换到 ${worktree.name}`}
        className={cx(
          ROW,
          "relative pr-2.5 pl-4",
          props.selected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-interactive-hover",
          quiet && "text-muted-foreground"
        )}
        onBlur={() => props.onHover?.(null)}
        onClick={() => props.onSelect?.(worktree.id)}
        onFocus={() => props.onHover?.(worktree.id)}
        onMouseEnter={() => props.onHover?.(worktree.id)}
        onMouseLeave={() => props.onHover?.(null)}
        title={unseen ? STATE_META.doneUnseen.label : undefined}
        type="button"
      >
        {props.pending && !props.pending.startsWith("失败") ? <Slider edge="bottom" tier="s1" /> : null}
        <Swatch identity={worktree.identity} />
        <span className={cx("truncate", unseen && "font-semibold")}>{worktree.name}</span>
        {worktree.main ? <span className="shrink-0 rounded border border-border px-1 text-[11px] text-muted-foreground leading-[16px]">主目录</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {props.pending ? <span className="text-[11px] text-muted-foreground">{props.pending}</span> : null}
          {worktree.changes ? <span className="font-mono text-[11px] text-muted-foreground tabular-nums">±{worktree.changes}</span> : null}
          {state ? <StateDot state={state} /> : null}
        </span>
      </button>
      {props.expanded
        ? worktree.sessions.map((session) => (
            <SessionRow key={session.id} onLocate={props.onLocateSession} session={session} />
          ))
        : null}
    </div>
  );
}

export function WorkspaceRail(props: {
  readonly expandedWorktreeIds?: readonly string[];
  readonly loading?: boolean;
  readonly onHoverWorktree?: ((id: string | null) => void) | undefined;
  readonly onLocateSession?: ((session: DemoSession) => void) | undefined;
  readonly onOpenDestination?: ((id: string) => void) | undefined;
  readonly onSelectWorktree?: ((id: string) => void) | undefined;
  readonly pending?: { readonly projectId: string; readonly worktree: DemoWorktree; readonly phase: string };
  readonly projects: readonly DemoProject[];
  readonly recents?: readonly string[];
  readonly selectedDestinationId?: string | undefined;
  readonly selectedWorktreeId?: string | undefined;
}): ReactNode {
  const expanded = new Set(props.expandedWorktreeIds ?? []);
  const empty = props.projects.length === 0;
  return (
    <nav aria-label="工作区" className="flex h-full shrink-0 flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground" style={{ width: RAIL_W }}>
      <div className="relative flex h-9 shrink-0 items-center px-3">
        <span className="font-medium text-[12px] text-muted-foreground">项目</span>
        {props.loading ? <Slider edge="bottom" tier="s1" /> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden px-1.5">
          {empty ? <div className="px-1.5 py-2 text-[12px] text-muted-foreground leading-5">还没有打开项目。打开一个项目文件夹，或者直接在右侧的终端里工作。</div> : null}
          {props.projects.map((project) => (
            <div className="flex flex-col gap-px" key={project.id}>
              <ProjectRow project={project} />
              {project.worktrees.map((tree) => (
                <WorktreeRow
                  expanded={expanded.has(tree.id)}
                  key={tree.id}
                  onHover={props.onHoverWorktree}
                  onLocateSession={props.onLocateSession}
                  onSelect={props.onSelectWorktree}
                  selected={props.selectedWorktreeId === tree.id}
                  worktree={tree}
                />
              ))}
              {props.pending && props.pending.projectId === project.id ? (
                <WorktreeRow expanded={false} pending={props.pending.phase} selected={false} worktree={props.pending.worktree} />
              ) : null}
            </div>
          ))}
          {empty && props.recents && props.recents.length > 0 ? (
            <div className="mt-3 flex flex-col gap-px">
              <div className="px-1.5 pb-1 font-medium text-[12px] text-muted-foreground">最近</div>
              {props.recents.map((path) => (
                <button aria-label={`打开 ${path}`} className={cx(ROW, "px-1.5 text-muted-foreground hover:bg-interactive-hover")} key={path} type="button">
                  <Icon className="size-3.5 shrink-0" name="folder" />
                  <span className="truncate font-mono text-[12px]">{path}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {empty ? null : (
          <div className="shrink-0 border-border/50 border-t px-1.5 py-1.5">
            {SIDEBAR_DESTINATIONS.map((destination) => (
              <DestinationRow
                destination={destination}
                key={destination.id}
                onOpen={props.onOpenDestination}
                selected={props.selectedDestinationId === destination.id}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center border-border border-t px-1.5" style={{ height: TILE_STATUS_H }}>
        <Button className="w-full justify-start px-1.5 text-muted-foreground" size="status-bar" type="button" variant="ghost">
          <Icon className="size-3.5" data-icon="" name="folder" />
          打开项目…
        </Button>
      </div>
    </nav>
  );
}
