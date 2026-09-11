import {
  Badge,
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Item,
  ItemGroup,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "pier/canvas";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { COPY, type Locale } from "./copy.ts";
import {
  type ActivityStatus,
  DEMO_LOCAL_DIRECTORIES,
  DEMO_PROJECTS,
  DEMO_REMOTE_HOST,
  DEMO_REMOTE_PROJECTS,
  type Project,
  type Session,
  type Worktree,
} from "./data.ts";
import { SIDEBAR_DESIGN_CSS } from "./design-style.ts";
import { FOOTER_COPY, type UpdatePhase } from "./footer-copy.ts";
import { WorktreePeek } from "./hover-peeks.tsx";
import { BrandGlyph, Glyph } from "./icons.tsx";
import identityPalette from "./identity-palette.generated.json" with {
  type: "json",
};
import {
  fileCount,
  projectControlLabel,
  sessionControlLabel,
  treeControlLabel,
} from "./sidebar-labels.ts";

export type Scenario =
  | "normal"
  | "empty"
  | "remote"
  | "directory"
  | "loading"
  | "error";

function Hint({
  children,
  side = "top",
  text,
}: {
  children: ReactElement;
  side?: "top" | "bottom";
  text: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{text}</TooltipContent>
    </Tooltip>
  );
}

function State({
  status,
  session = false,
}: {
  status: ActivityStatus;
  session?: boolean;
}) {
  return (
    <span aria-hidden="true" className="sv-state" data-status={status}>
      {(!session || status !== "idle") && <span className="sv-dot" />}
    </span>
  );
}

function aggregate(project: Project): ActivityStatus {
  if (project.worktrees.some((tree) => tree.status === "attention")) {
    return "attention";
  }
  return project.worktrees.some((tree) => tree.status === "running")
    ? "running"
    : "idle";
}

function Summary({ tree, locale }: { tree: Worktree; locale: Locale }) {
  const summary = tree.summary;
  if (!summary) {
    return null;
  }
  return (
    <span aria-hidden="true" className="sv-summary">
      {summary.kind === "lineDelta" ? (
        <>
          <span className="sv-summary-full">
            <span className="sv-added">+{summary.insertions}</span>
            <span className="sv-removed">{`\u2212${summary.deletions}`}</span>
          </span>
          <span className="sv-summary-count">{fileCount(tree, locale)}</span>
        </>
      ) : (
        <span>{fileCount(tree, locale)}</span>
      )}
    </span>
  );
}

interface IdentityStyle extends CSSProperties {
  "--sv-identity-dark": string;
  "--sv-identity-light": string;
}

function Identity({ tree }: { tree: Worktree }) {
  const style: IdentityStyle = {
    "--sv-identity-dark": identityPalette.dark[tree.identity],
    "--sv-identity-light": identityPalette.light[tree.identity],
    backgroundColor: `var(--identity-${tree.identity}, var(--sv-identity-fallback))`,
  };
  return (
    <span aria-hidden="true" className="sv-leading">
      <span className="sv-identity" style={style} />
    </span>
  );
}

function Footer({
  locale,
  onFeedback,
  phase,
  onPhaseChange,
}: {
  locale: Locale;
  onFeedback: (value: string) => void;
  phase: UpdatePhase;
  onPhaseChange: (value: UpdatePhase) => void;
}) {
  const c = FOOTER_COPY[locale];
  const [open, setOpen] = useState<"notifications" | "update" | null>(null);
  const title =
    phase === "available"
      ? c.availableTitle
      : phase === "downloading"
        ? c.progressTitle
        : c.downloadedTitle;
  const description =
    phase === "available"
      ? c.availableBody
      : phase === "downloading"
        ? c.progressBody
        : c.downloadedBody;
  const updateAction =
    phase === "available"
      ? c.downloadDemo
      : phase === "downloading"
        ? c.finishDemo
        : c.resetDemo;
  const updateTrigger = (
    <PopoverTrigger asChild>
      <Button
        aria-label={title}
        className="sv-tool"
        data-phase={phase}
        size={phase === "downloading" ? "sm" : "icon"}
        tone={phase === "downloading" ? "default" : "muted"}
        variant="ghost"
      >
        <Glyph name={phase === "downloaded" ? "rotate-cw" : "download"} />
        {phase === "available" && (
          <span aria-hidden="true" className="sv-update-indicator" />
        )}
        {phase === "downloading" && (
          <span className="sv-update-label">{c.progressValue}</span>
        )}
      </Button>
    </PopoverTrigger>
  );
  return (
    <footer aria-label={c.tools} className="sv-footer">
      <Button
        aria-label={c.settings}
        className="sv-tool sv-settings"
        onClick={() => {
          setOpen(null);
          onFeedback(c.settings);
        }}
        variant="ghost"
      >
        <Glyph name="settings" />
        <span>{c.settings}</span>
      </Button>
      {phase !== "none" && (
        <Popover
          onOpenChange={(value: boolean) => {
            setOpen(value ? "update" : null);
            if (value) {
              onFeedback("");
            }
          }}
          open={open === "update"}
        >
          {phase === "downloading" ? (
            updateTrigger
          ) : (
            <Hint text={title}>{updateTrigger}</Hint>
          )}
          <PopoverContent align="start" className="sv-popover" side="top">
            <PopoverHeader>
              <PopoverTitle>{title}</PopoverTitle>
              <PopoverDescription>{description}</PopoverDescription>
            </PopoverHeader>
            <Button
              className="sv-popover-footer"
              onClick={() => {
                const next =
                  phase === "available"
                    ? "downloading"
                    : phase === "downloading"
                      ? "downloaded"
                      : "available";
                onPhaseChange(next);
                onFeedback(
                  next === "downloading"
                    ? c.progressTitle
                    : next === "downloaded"
                      ? c.downloadedTitle
                      : c.availableTitle
                );
              }}
              variant="outline"
            >
              {updateAction}
            </Button>
          </PopoverContent>
        </Popover>
      )}
      <Popover
        onOpenChange={(value: boolean) => {
          setOpen(value ? "notifications" : null);
          if (value) {
            onFeedback("");
          }
        }}
        open={open === "notifications"}
      >
        <Hint text={c.notifications}>
          <PopoverTrigger asChild>
            <Button
              aria-label={c.notifications}
              className="sv-tool"
              size="icon"
              tone="muted"
              variant="ghost"
            >
              <Glyph name="bell" />
            </Button>
          </PopoverTrigger>
        </Hint>
        <PopoverContent align="end" className="sv-popover" side="top">
          <PopoverHeader>
            <PopoverTitle>{c.notifications}</PopoverTitle>
          </PopoverHeader>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{c.emptyTitle}</EmptyTitle>
              <EmptyDescription>{c.emptyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </PopoverContent>
      </Popover>
    </footer>
  );
}

export interface SidebarDesignProps {
  locale?: Locale;
  onFeedback?: (value: string) => void;
  onScenarioChange?: (value: Scenario) => void;
  onUpdatePhaseChange: (value: UpdatePhase) => void;
  scenario?: Scenario;
  updatePhase: UpdatePhase;
  width?: number;
}

const NAV_KEYS = "ArrowDown ArrowUp Home End Escape Alt+ArrowDown";

function findProject(id: string): Project | undefined {
  return (
    DEMO_PROJECTS.find((project) => project.id === id) ??
    DEMO_REMOTE_PROJECTS.find((project) => project.id === id)
  );
}

function attentionTargets(): { projectId: string; sessionId: string }[] {
  const rows: { projectId: string; sessionId: string }[] = [];
  for (const project of [...DEMO_PROJECTS, ...DEMO_REMOTE_PROJECTS]) {
    for (const tree of project.worktrees) {
      for (const session of tree.sessions) {
        if (session.status === "attention") {
          rows.push({ projectId: project.id, sessionId: session.id });
        }
      }
    }
  }
  return rows;
}

function overlayOpen(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "[data-slot='popover-content'], [data-radix-popper-content-wrapper]"
      )
    )
  );
}

export function SidebarDesign({
  updatePhase,
  onUpdatePhaseChange,
  width = 256,
  locale = "zh-CN",
  scenario = "normal",
  onScenarioChange,
  onFeedback,
}: SidebarDesignProps) {
  const c = COPY[locale];
  const helpId = useId();
  const defaultTree = DEMO_PROJECTS[0]?.worktrees[0]?.key ?? "";
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(["harbor"])
  );
  const [selected, setSelected] = useState(defaultTree);
  const [located, setLocated] = useState("demo:pier:codex");
  const [elsewhere, setElsewhere] = useState("");
  const [read, setRead] = useState<Set<string>>(new Set());
  const [tasks, setTasks] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const pendingFocus = useRef<string | null>(null);
  const pendingSession = useRef<string | null>(null);
  const fromRecents = useRef(false);
  const fromRetry = useRef(false);
  const lastTree = useRef(defaultTree);
  useEffect(() => {
    if (fromRecents.current) {
      fromRecents.current = false;
      return;
    }
    if (fromRetry.current) {
      fromRetry.current = false;
      return;
    }
    if (scenario === "loading") {
      feedback(c.loading.replace("{{name}}", c.recentName));
      return;
    }
    if (scenario === "error") {
      feedback(c.loadFailed.replace("{{name}}", c.recentName));
      return;
    }
    setNotice("");
    onFeedback?.("");
  }, [scenario]);
  function feedback(value: string) {
    const message = value ? `${c.actionPreview} · ${value}` : "";
    setNotice(message);
    onFeedback?.(message);
  }
  function focusTree(key: string) {
    pendingFocus.current = key;
  }
  function toggle(id: string, fold?: boolean) {
    const project = findProject(id);
    const nextFold = fold ?? !collapsed.has(id);
    setCollapsed((current) => {
      const next = new Set(current);
      if (nextFold) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
    feedback(
      (nextFold ? c.collapsedProject : c.expandedProject).replace(
        "{{name}}",
        project?.name ?? id
      )
    );
  }
  function navButtons(from: HTMLElement): HTMLButtonElement[] {
    const root = from.closest(".sv4");
    if (!root) {
      return [];
    }
    return Array.from(
      root.querySelectorAll<HTMLButtonElement>("button[data-nav]")
    );
  }
  function jumpAttention(from: HTMLButtonElement) {
    const targets = attentionTargets();
    if (targets.length === 0) {
      return;
    }
    const index = targets.findIndex(
      (row) => row.sessionId === from.dataset.session
    );
    const next = targets[(index + 1) % targets.length] ?? targets[0];
    if (!next) {
      return;
    }
    setCollapsed((current) => {
      const nextSet = new Set(current);
      nextSet.delete(next.projectId);
      return nextSet;
    });
    pendingSession.current = next.sessionId;
  }
  function escapeNav(from: HTMLElement) {
    if (overlayOpen(from)) {
      return;
    }
    if (tasks) {
      const key = lastTree.current;
      setTasks(false);
      if (key) {
        setSelected(key);
        focusTree(key);
      }
      feedback(c.leftTasks);
      return;
    }
    if (located) {
      setLocated("");
      if (selected) {
        focusTree(selected);
      }
      feedback(c.clearedLocate);
      return;
    }
    if (elsewhere) {
      setElsewhere("");
      feedback(c.clearedLocate);
    }
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, project?: string) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (peekId) {
        setPeekId(null);
        return;
      }
      escapeNav(event.currentTarget);
      return;
    }
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      jumpAttention(event.currentTarget);
      return;
    }
    if (project && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      toggle(project, event.key === "ArrowLeft");
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const rows = navButtons(event.currentTarget);
    const index = rows.indexOf(event.currentTarget);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : Math.max(
              0,
              Math.min(
                rows.length - 1,
                index + (event.key === "ArrowDown" ? 1 : -1)
              )
            );
    event.preventDefault();
    rows[next]?.focus();
  }
  function select(tree: Worktree) {
    lastTree.current = tree.key;
    setSelected(tree.key);
    setLocated("");
    setElsewhere("");
    setTasks(false);
    if (scenario === "empty") {
      fromRecents.current = true;
      pendingFocus.current = tree.key;
      setCollapsed(new Set());
      onScenarioChange?.("normal");
    }
    feedback(c.switched.replace("{{name}}", tree.name));
  }
  function locate(tree: Worktree, session: Session) {
    setRead((current) => new Set(current).add(session.id));
    setTasks(false);
    if (session.windowLabel) {
      setElsewhere(session.id);
      if (!selected && lastTree.current) {
        setSelected(lastTree.current);
      }
      feedback(
        `${c.located.replace("{{name}}", session.title)} · ${session.windowLabel}`
      );
      return;
    }
    lastTree.current = tree.key;
    setSelected(tree.key);
    setLocated(session.id);
    setElsewhere("");
    feedback(c.located.replace("{{name}}", session.title));
  }
  function openTasks() {
    if (selected) {
      lastTree.current = selected;
    }
    setTasks(true);
    setSelected("");
    setLocated("");
    setElsewhere("");
    feedback(c.tasks);
  }
  function treeRows(tree: Worktree) {
    const unread = tree.sessions.some(
      (session) => session.unread && !read.has(session.id)
    );
    const treeCurrent = selected === tree.key && !tasks;
    return (
      <li className="sv-worktree-group" key={tree.key}>
        <HoverCard
          closeDelay={100}
          onOpenChange={(open) => setPeekId(open ? tree.key : null)}
          open={peekId === tree.key}
          openDelay={400}
        >
          <HoverCardTrigger asChild>
            <Item asChild className="sv-row sv-worktree h-7 py-0" size="xs">
              <button
                aria-current={treeCurrent && !located ? "location" : undefined}
                aria-keyshortcuts={NAV_KEYS}
                aria-label={treeControlLabel(tree, locale, unread)}
                data-main={Boolean(tree.isMain)}
                data-nav
                data-selected={treeCurrent}
                data-tree={tree.key}
                onClick={() => select(tree)}
                onFocus={() => setPeekId(tree.key)}
                onKeyDown={(event) => keyboard(event)}
                ref={(node) => {
                  if (node && pendingFocus.current === tree.key) {
                    pendingFocus.current = null;
                    node.focus();
                  }
                }}
                type="button"
              >
                <Identity tree={tree} />
                <span className="sv-name">
                  <span className="sv-name-text" data-unread={unread}>
                    {tree.name}
                  </span>
                  {tree.isMain && (
                    <Badge
                      aria-hidden="true"
                      className="px-1.5"
                      variant="outline"
                    >
                      {c.mainDirectoryShort}
                    </Badge>
                  )}
                </span>
                <Summary locale={locale} tree={tree} />
                <State status={tree.status} />
              </button>
            </Item>
          </HoverCardTrigger>
          <HoverCardContent align="start" className="w-64 p-3" side="right">
            <WorktreePeek locale={locale} tree={tree} />
          </HoverCardContent>
        </HoverCard>
        {tree.sessions.length > 0 ? (
          <ItemGroup className="sv-list sv-sessions">
            {tree.sessions.map((session) => {
              const sessionUnread = !!session.unread && !read.has(session.id);
              const here =
                located === session.id && selected === tree.key && !tasks;
              const away = elsewhere === session.id;
              return (
                <li key={session.id}>
                  <Item asChild className="sv-row sv-session h-7 py-0" size="xs">
                    <button
                      aria-current={here ? "page" : undefined}
                      aria-keyshortcuts={NAV_KEYS}
                      aria-label={sessionControlLabel(
                        session,
                        tree.name,
                        locale,
                        sessionUnread,
                        here,
                        away
                      )}
                      data-attention={session.status === "attention"}
                      data-elsewhere={away}
                      data-located={here}
                      data-nav
                      data-session={session.id}
                      onClick={() => locate(tree, session)}
                      onKeyDown={(event) => keyboard(event)}
                      ref={(node) => {
                        if (node && pendingSession.current === session.id) {
                          pendingSession.current = null;
                          node.focus();
                        }
                      }}
                      type="button"
                    >
                      <span className="sv-leading">
                        {session.agentId ? (
                          <BrandGlyph name={session.agentId} />
                        ) : (
                          <Glyph name="square-terminal" />
                        )}
                      </span>
                      <span className="sv-name-text" data-unread={sessionUnread}>
                        {session.title}
                      </span>
                      {session.windowLabel && (
                        <span className="sv-window-label">
                          <Glyph data-icon="inline-end" name="arrow-up-right" />
                          <span>{c.otherWindow}</span>
                        </span>
                      )}
                      <State session status={session.status} />
                    </button>
                  </Item>
                </li>
              );
            })}
          </ItemGroup>
        ) : null}
      </li>
    );
  }
  function projectRows(project: Project) {
    const folded = collapsed.has(project.id);
    const createLabel = c.newWorktreeFor.replace("{{name}}", project.name);
    return (
      <li className="sv-project" key={project.id}>
        <div className="sv-project-wrap">
          <Item asChild className="sv-row sv-project-row h-7 py-0" size="xs">
            <button
              aria-expanded={!folded}
              aria-keyshortcuts={NAV_KEYS}
              aria-label={projectControlLabel(
                project,
                locale,
                aggregate(project)
              )}
              data-nav
              data-project={project.id}
              onClick={() => toggle(project.id)}
              onKeyDown={(event) => keyboard(event, project.id)}
              type="button"
            >
              <Glyph name={folded ? "chevron-right" : "chevron-down"} />
              <span className="sv-name-text">{project.name}</span>
              <State status={aggregate(project)} />
            </button>
          </Item>
          <Hint text={createLabel}>
            <Button
              aria-label={createLabel}
              className="sv-tool sv-create"
              onClick={() => feedback(createLabel)}
              size="icon-xs"
              tone="muted"
              variant="ghost"
            >
              <Glyph name="plus" />
            </Button>
          </Hint>
        </div>
        {!folded && (
          <ItemGroup className="sv-list sv-worktrees">
            {project.worktrees.map(treeRows)}
          </ItemGroup>
        )}
      </li>
    );
  }
  function projectBody() {
    if (scenario === "empty") {
      return (
        <>
          <Empty className="sv-empty">
            <EmptyHeader>
              <EmptyTitle>{c.emptyTitle}</EmptyTitle>
              <EmptyDescription>{c.emptyDescription}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => feedback(c.openProject)} variant="outline">
                {c.openProject}
              </Button>
            </EmptyContent>
          </Empty>
          <h3 className="sv-recent-heading">{c.recent}</h3>
          <ItemGroup className="sv-list">
            <li>
              <Item asChild className="sv-row sv-recent h-7 py-0" size="xs">
                <button
                  aria-keyshortcuts={NAV_KEYS}
                  data-nav
                  onClick={() => {
                    const tree = DEMO_PROJECTS[0]?.worktrees[0];
                    if (tree) {
                      select(tree);
                    }
                  }}
                  onKeyDown={(event) => keyboard(event)}
                  type="button"
                >
                  <Glyph name="folder-open" />
                  <span className="sv-name">{c.recentName}</span>
                  <span className="sv-recent-path">{c.recentPath}</span>
                </button>
              </Item>
            </li>
          </ItemGroup>
        </>
      );
    }
    if (scenario === "loading") {
      return (
        <p aria-hidden="true" className="sv-status-copy">
          {c.loading.replace("{{name}}", c.recentName)}
        </p>
      );
    }
    if (scenario === "error") {
      return (
        <Empty className="sv-empty">
          <EmptyHeader>
            <EmptyTitle>
              {c.loadFailed.replace("{{name}}", c.recentName)}
            </EmptyTitle>
            <EmptyDescription>{c.loadFailedDescription}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => {
                fromRetry.current = true;
                pendingFocus.current = defaultTree;
                setSelected(defaultTree);
                onScenarioChange?.("normal");
                feedback(c.retry);
              }}
              variant="outline"
            >
              {c.retry}
            </Button>
          </EmptyContent>
        </Empty>
      );
    }
    return (
      <ItemGroup className="sv-list">
        {DEMO_PROJECTS.map(projectRows)}
      </ItemGroup>
    );
  }
  return (
    <TooltipProvider delayDuration={200}>
      <aside
        aria-describedby={helpId}
        aria-label={c.sidebar}
        className="sv4"
        data-pier-comment-id="sidebar-design-root"
        style={{ width }}
      >
        <style>{SIDEBAR_DESIGN_CSS}</style>
        <span className="sr-only" id={helpId}>
          {c.keyboardHelp}
        </span>
        <header className="sv-head">
          <div className="sv-chrome">
            <div aria-hidden="true" className="sv-traffic">
              <i />
              <i />
              <i />
            </div>
            <Hint side="bottom" text={c.sidebarToggle}>
              <Button
                aria-label={c.sidebarToggle}
                className="sv-tool"
                onClick={() => feedback(c.sidebarToggle)}
                size="icon"
                tone="muted"
                variant="ghost"
              >
                <Glyph name="panel-left" />
              </Button>
            </Hint>
          </div>
          <ItemGroup className="sv-list">
            <li>
              <Item
                asChild
                className="sv-row sv-destination h-7 py-0"
                size="xs"
              >
                <button
                  aria-current={tasks ? "page" : undefined}
                  aria-keyshortcuts={NAV_KEYS}
                  data-nav
                  data-selected={tasks}
                  onClick={openTasks}
                  onKeyDown={(event) => keyboard(event)}
                  type="button"
                >
                  <Glyph name="list-todo" />
                  <span className="sv-name">{c.tasks}</span>
                </button>
              </Item>
            </li>
          </ItemGroup>
        </header>
        <div className="sv-scroll">
          <section aria-busy={scenario === "loading"} className="sv-section">
            <div className="sv-section-head">
              <h2>{c.projects}</h2>
              <Hint text={c.openProject}>
                <Button
                  aria-label={c.openProject}
                  className="sv-tool"
                  onClick={() => feedback(c.openProject)}
                  size="icon"
                  tone="muted"
                  variant="ghost"
                >
                  <Glyph name="folder-open" />
                </Button>
              </Hint>
            </div>
            {projectBody()}
          </section>
          {scenario === "remote" && (
            <section className="sv-section">
              <div className="sv-section-head">
                <h2>{c.sshHost.replace("{{host}}", DEMO_REMOTE_HOST)}</h2>
              </div>
              <ItemGroup className="sv-list">
                {DEMO_REMOTE_PROJECTS.map(projectRows)}
              </ItemGroup>
            </section>
          )}
          {scenario === "directory" && (
            <section className="sv-section sv-local">
              <div className="sv-section-head">
                <h2>{c.localDirectories}</h2>
              </div>
              <ItemGroup className="sv-list sv-worktrees">
                {DEMO_LOCAL_DIRECTORIES.map(treeRows)}
              </ItemGroup>
            </section>
          )}
        </div>
        <Footer
          locale={locale}
          onFeedback={feedback}
          onPhaseChange={onUpdatePhaseChange}
          phase={updatePhase}
        />
        <span aria-live="polite" className="sr-only" role="status">
          {notice}
        </span>
      </aside>
    </TooltipProvider>
  );
}
