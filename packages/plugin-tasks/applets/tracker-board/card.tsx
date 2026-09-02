import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
} from "pier/canvas";
import { Fragment } from "react";
import { type Translate, useCopy } from "../copy/index.ts";
import { columnKindOf } from "./columns.ts";
import {
  type CardActivityStatus,
  type TaskBoardModel,
  type TaskCardModel,
  type TaskColumnId,
} from "./hooks.ts";
import { CardActionsMenu } from "./menu.tsx";
import {
  ISSUE_ID_CLASS,
  ISSUE_LINK_CLASS,
  TaskStatusBadges,
} from "./status-badges.tsx";

export {
  ActivityBadge,
  INFO_BADGE_CLASS,
  ISSUE_ID_CLASS,
  ISSUE_LINK_CLASS,
  TaskStatusBadges,
} from "./status-badges.tsx";

/** Reserves the ··· slot when write access is stripped: visibility toggles, layout never does. */
export const MENU_SLOT_PLACEHOLDER_CLASS = "size-5 shrink-0";
const BOARD_CARD_CLASS =
  "group relative flex w-full min-w-0 flex-col gap-1.5 rounded-2xl border border-border/60 bg-card p-2 text-left shadow-xs outline-none transition-all hover:border-foreground/20 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/40";
const BOARD_CARD_CYCLE_CLASS =
  "group relative flex w-full min-w-0 flex-col gap-1.5 rounded-2xl border border-border/60 bg-card p-2 text-left shadow-xs outline-none transition-all hover:border-foreground/20 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/40 ring-1 ring-destructive/60";
const BOARD_TITLE_CLASS =
  "w-full min-w-0 text-left text-[13px] font-medium leading-[1.38] tracking-[-0.01em] text-foreground";
const BOARD_META_CLASS =
  "flex w-full min-w-0 items-center justify-between gap-1.5 pt-0.5";

/** Helper to extract clean initials from username or full name */
function getInitials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  const p0 = parts[0];
  const p1 = parts[1];
  if (parts.length >= 2 && p0 && p1) {
    const c0 = p0[0] ?? "";
    const c1 = p1[0] ?? "";
    return (c0 + c1).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** One assignee representation across board, list, and graph. */
export function AssigneeChip({
  avatarUrl,
  compact = false,
  login,
}: {
  avatarUrl?: string | undefined;
  compact?: boolean;
  login: string;
}) {
  const initials = getInitials(login);
  const avatar = (
    <Avatar className="size-4.5 border border-border/60 shadow-2xs">
      {avatarUrl ? (
        <AvatarImage alt={login} src={avatarUrl} />
      ) : null}
      <AvatarFallback className="text-[9px] font-semibold text-muted-foreground/90 bg-muted">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
  if (compact) {
    return (
      <span className="inline-flex shrink-0" title={login}>
        {avatar}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 align-middle text-xs text-muted-foreground" title={login}>
      {avatar}
      <span className="max-w-24 truncate font-medium text-foreground/80">{login}</span>
    </span>
  );
}

/** "#41" — the bound repo is implied; full owner/name stays in tooltips. */
export function shortIssueKey(key: string): string {
  const hash = key.indexOf("#");
  return hash >= 0 ? key.slice(hash) : key;
}

/**
 * One cycle grammar everywhere: keys appearing in BOTH edge directions are
 * cycle partners and collapse to a single "cycle with #N" segment; remaining
 * one-directional edges keep their own segments.
 */
export function splitCycleRefs(input: {
  blockers: readonly string[];
  blocks: readonly string[];
  inCycle: boolean;
}): { blockedBy: string[]; blocks: string[]; cycleWith: string[] } {
  if (!input.inCycle) {
    return {
      blockedBy: [...input.blockers],
      blocks: [...input.blocks],
      cycleWith: [],
    };
  }
  const partners = input.blockers.filter((key) => input.blocks.includes(key));
  return {
    blockedBy: input.blockers.filter((key) => !partners.includes(key)),
    blocks: input.blocks.filter((key) => !partners.includes(key)),
    cycleWith: partners,
  };
}

/**
 * Cards/rows register as jump targets so blocker tokens can navigate. The
 * scope keeps ids unique when board and list render in the same document.
 */
export function taskCardDomId(scope: string, key: string): string {
  return `task-${scope}-${key}`;
}

const JUMP_FLASH_CLASSES = ["ring-2", "ring-ring/60"];

export function jumpToTaskCard(scope: string, key: string) {
  const target = document.getElementById(taskCardDomId(scope, key));
  if (!target) {
    return;
  }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  // Flash the landing card so the eye knows where the jump ended.
  target.classList.add(...JUMP_FLASH_CLASSES);
  window.setTimeout(() => {
    target.classList.remove(...JUMP_FLASH_CLASSES);
  }, 1600);
}

/** Hovering an edge link rings the node it resolves to (pre-click preview). */
export function previewTaskCard(scope: string, key: string, on: boolean) {
  const target = document.getElementById(taskCardDomId(scope, key));
  if (!target) {
    return;
  }
  if (on) {
    target.classList.add(...JUMP_FLASH_CLASSES);
  } else {
    target.classList.remove(...JUMP_FLASH_CLASSES);
  }
}

/**
 * "blocked by #41, owner/repo#88 +1 ·" — inline edge references with strict
 * wrap discipline: the label and first identifier are atomic, every separator
 * glues to the segment before it (a line never opens with "·" or ","), and
 * keys without a card on this surface render as plain text instead of links.
 */
export function EdgeRefs({
  keys,
  known,
  label,
  ownKey,
  scope,
  trailingSep = false,
}: {
  keys: readonly string[];
  known?: ReadonlySet<string>;
  label: string;
  ownKey: string;
  scope: string;
  trailingSep?: boolean;
}) {
  const { t } = useCopy();
  if (keys.length === 0) {
    return null;
  }
  const prefix = ownKey.split("#")[0];
  const shown = keys.slice(0, 2).map((key) => ({
    full: key,
    short:
      prefix && key.startsWith(`${prefix}#`) ? key.slice(prefix.length) : key,
  }));
  const rest = keys.length - shown.length;
  const token = (item: { full: string; short: string }) =>
    known && !known.has(item.full) ? (
      <span title={t("badge.externalRef")}>{item.short}</span>
    ) : (
      <Button
        className={ISSUE_LINK_CLASS}
        onClick={() => jumpToTaskCard(scope, item.full)}
        onMouseEnter={() => previewTaskCard(scope, item.full, true)}
        onMouseLeave={() => previewTaskCard(scope, item.full, false)}
        title={t("edge.jumpTo", { key: item.full })}
        type="button"
        variant="link"
      >
        {item.short}
      </Button>
    );
  const last = shown.length - 1;
  return (
    <>
      {shown.map((item, index) => {
        const suffix =
          index < last
            ? ","
            : `${rest > 0 ? ` +${rest}` : ""}${trailingSep ? " ·" : ""}`;
        return (
          // The space between segments stays OUTSIDE the nowrap span: it is
          // the only legal wrap opportunity in the run.
          <Fragment key={item.full}>
            {" "}
            <span className="whitespace-nowrap">
              {index === 0 ? `${label} ` : ""}
              {token(item)}
              {suffix}
            </span>
          </Fragment>
        );
      })}
    </>
  );
}

export {
  CARD_MENU_TRIGGER_CLASS,
  CardActionsMenu,
  type CardMenuActions,
} from "./menu.tsx";

/** "A → B → A" — the loop, readable where the red ring is. */
export function cycleLoopLabel(
  cycleKeys: readonly string[],
  t: Translate
): string {
  if (cycleKeys.length === 0) {
    return t("badge.cycleEmpty");
  }
  return t("badge.cycleLoop", {
    loop: [...cycleKeys, cycleKeys[0]].join(" → "),
  });
}

export function TaskCardView({
  activity,
  blocks = [],
  board,
  card,
  columnId,
  inCycle = false,
  onConfirmDone,
  onFocusWork,
  onMove,
  onOpenIssue,
  onPrune,
  onStartWork,
}: {
  activity: CardActivityStatus;
  blocks?: readonly string[];
  board: TaskBoardModel;
  card: TaskCardModel;
  columnId: TaskColumnId;
  inCycle?: boolean;
  onConfirmDone: (itemKey: string) => void;
  onFocusWork: (panelId: string) => void;
  onMove: (itemKey: string, columnId: TaskColumnId, index?: number) => void;
  onOpenIssue: (url: string) => void;
  onPrune: (itemKey: string) => void;
  onStartWork: (itemKey: string) => void;
}) {
  const laneKind = columnKindOf(
    board.columns.find((column) => column.id === columnId) ?? { id: columnId }
  );
  const doneLane = laneKind === "done" || laneKind === "canceled";
  // "Ready" answers "can I start this?" — only meaningful in an open lane,
  // and never while the card sits in a dependency cycle.
  const ready = laneKind === "todo" && card.openBlockedByCount === 0 && !inCycle;
  const canWrite = board.canWrite;
  const workPanelId = card.work?.panelId;
  const merged = card.linkedPRs.some((pr) => pr.merged);
  const blocked = card.openBlockedByCount > 0;
  const refs = splitCycleRefs({
    blockers: (card.blockers ?? []).map((blocker) => blocker.key),
    blocks: inCycle ? blocks : [],
    inCycle,
  });
  // Cycle members still show Blocked when a NON-cycle blocker survives:
  // breaking the loop alone will not free them.
  const showBlockedBadge = inCycle ? refs.blockedBy.length > 0 : blocked;
  // Refs without a card on this board render as inert muted text (same rule
  // as the graph): underline strictly means "this navigates".
  const knownKeys = new Set(
    board.columns.flatMap((column) => column.items.map((item) => item.key))
  );
  const hasRefs =
    refs.cycleWith.length > 0 ||
    refs.blockedBy.length > 0 ||
    refs.blocks.length > 0;
  const { t } = useCopy();

  return (
    <div
      className={inCycle ? BOARD_CARD_CYCLE_CLASS : BOARD_CARD_CLASS}
      data-board-card=""
      id={taskCardDomId("board", card.key)}
      onClick={(event) => {
        const target = event.target;
        const el =
          target instanceof Element
            ? target
            : target instanceof Node
              ? target.parentElement
              : null;
        if (el?.closest("button, a")) {
          return;
        }
        onOpenIssue(card.url);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        onOpenIssue(card.url);
      }}
      role="button"
      tabIndex={0}
    >
      <div
        className={
          doneLane
            ? `${BOARD_TITLE_CLASS} text-muted-foreground`
            : BOARD_TITLE_CLASS
        }
        data-board-card-title=""
        data-done={doneLane ? "" : undefined}
        title={card.title}
      >
        {card.title}
      </div>
      {hasRefs ? (
        <div className="text-xs text-muted-foreground">
          <EdgeRefs
            keys={refs.cycleWith}
            known={knownKeys}
            label={t("edge.cycleWith")}
            ownKey={card.key}
            scope="board"
            trailingSep={refs.blockedBy.length > 0 || refs.blocks.length > 0}
          />
          <EdgeRefs
            keys={refs.blockedBy}
            known={knownKeys}
            label={t("edge.blockedBy")}
            ownKey={card.key}
            scope="board"
            trailingSep={refs.blocks.length > 0}
          />
          <EdgeRefs
            keys={refs.blocks}
            known={knownKeys}
            label={t("edge.blocks")}
            ownKey={card.key}
            scope="board"
          />
        </div>
      ) : null}
      {card.labels && card.labels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {card.labels.slice(0, 3).map((label) => (
            <span
              className="inline-flex items-center gap-1 rounded-xs px-1.5 py-0.25 text-[10px] font-medium leading-tight bg-muted/60 text-muted-foreground border border-border/30"
              key={label.name}
            >
              {label.color ? (
                <span
                  className="size-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: `#${label.color.replace(/^#/, "")}` }}
                />
              ) : null}
              <span className="truncate max-w-24">{label.name}</span>
            </span>
          ))}
          {card.labels.length > 3 ? (
            <span className="text-[10px] text-muted-foreground font-mono">
              +{card.labels.length - 3}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={BOARD_META_CLASS} data-board-card-footer="">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <Button
            className={ISSUE_ID_CLASS}
            data-board-issue-id=""
            onClick={(e) => {
              e.stopPropagation();
              onOpenIssue(card.url);
            }}
            title={t("edge.openIssue", { key: card.key })}
            type="button"
            variant="link"
          >
            {shortIssueKey(card.key)}
          </Button>
          <TaskStatusBadges
            activity={activity}
            blocked={showBlockedBadge}
            blockedDetail={
              (card.blockers ?? []).length > 0
                ? (card.blockers ?? [])
                    .map((blocker) => blocker.title ?? blocker.key)
                    .join(" · ")
                : t("badge.waitingOn", { count: card.openBlockedByCount })
            }
            cycleDetail={cycleLoopLabel(board.cycleKeys ?? [], t)}
            inCycle={inCycle}
            merged={merged}
            mutedMerged={doneLane}
            onFocusWork={onFocusWork}
            panelId={workPanelId}
            ready={ready}
            suppressReady={canWrite}
            workPath={card.work?.path}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1" data-board-card-actions="">
          {card.assignee ? (
            <AssigneeChip
              avatarUrl={card.assignee.avatarUrl}
              compact
              login={card.assignee.login}
            />
          ) : null}
          {canWrite ? (
            <span data-board-card-menu="">
              <CardActionsMenu
                actions={{
                  onConfirmDone,
                  onFocusWork,
                  onMove,
                  onOpenIssue,
                  onPrune,
                  onStartWork,
                }}
                board={board}
                card={card}
                columnId={columnId}
                size="icon-xs"
                triggerClassName="size-4.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center justify-center text-[10px] leading-none transition-colors"
              />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
