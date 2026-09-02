import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "pier/canvas";
import { columnLabel, useCopy } from "../copy/index.ts";
import { isDoneColumn, isTerminalColumn } from "./columns.ts";
import {
  linkedPullRequestsAllowDone,
  type TaskBoardModel,
  type TaskCardModel,
  type TaskColumnId,
} from "./hooks.ts";

/** ··· trigger reveal-on-hover classes (expects `group/item` from Item). */
export const CARD_MENU_TRIGGER_CLASS =
  "shrink-0 text-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-hover/item:opacity-100 group-focus-within:opacity-100 group-focus-within/item:opacity-100 data-[state=open]:opacity-100";

export interface CardMenuActions {
  onConfirmDone: (itemKey: string) => void;
  onFocusWork: (panelId: string) => void;
  onMove: (itemKey: string, columnId: TaskColumnId) => void;
  onOpenIssue: (url: string) => void;
  onPrune: (itemKey: string) => void;
  onStartWork: (itemKey: string) => void;
}

/**
 * One task menu for board cards and list rows: safe navigation first, then
 * the primary verb (Start work / Focus session), then moves, then
 * tracker-destructive actions.
 */
export function CardActionsMenu({
  actions,
  board,
  card,
  columnId,
  size = "icon",
  triggerClassName,
}: {
  actions: CardMenuActions;
  board: TaskBoardModel;
  card: TaskCardModel;
  columnId: TaskColumnId;
  size?: "icon" | "icon-xs";
  triggerClassName?: string;
}) {
  const current = board.columns.find((column) => column.id === columnId);
  const isDone = current ? isDoneColumn(current) : columnId === "done";
  const working = Boolean(card.work);
  const workPanelId = card.work?.panelId;
  const doneAllowed = linkedPullRequestsAllowDone(card.linkedPRs);
  const heuristic = board.columnMapping === "heuristic";
  const moveTargets = board.columns.filter((column) => {
    if (column.id === columnId) {
      return false;
    }
    return !(heuristic && isTerminalColumn(column));
  });
  const canClose = !(isDone || doneAllowed);
  const canPrune = Boolean(
    card.work && (doneAllowed || card.linkedPRs.length === 0)
  );
  const { t } = useCopy();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("menu.actions")}
          className={triggerClassName ?? CARD_MENU_TRIGGER_CLASS}
          size={size}
          type="button"
          variant="ghost"
        >
          <svg
            aria-hidden
            className="size-3.5 shrink-0"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <circle cx="3" cy="8" r="1.25" />
            <circle cx="8" cy="8" r="1.25" />
            <circle cx="13" cy="8" r="1.25" />
          </svg>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Navigation first: it is safe and buys distance from the red zone. */}
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => actions.onOpenIssue(card.url)}>
            {t("menu.viewInTracker")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              navigator.clipboard.writeText(card.url).catch(() => undefined);
            }}
          >
            {t("menu.copyLink")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {working ? (
            <DropdownMenuItem
              disabled={!workPanelId}
              onClick={() => {
                if (workPanelId) {
                  actions.onFocusWork(workPanelId);
                }
              }}
            >
              {t("menu.focusSession")}
            </DropdownMenuItem>
          ) : isDone ? null : (
            <DropdownMenuItem onClick={() => actions.onStartWork(card.key)}>
              <span className="flex flex-col items-start">
                {t("menu.startWork")}
                <span className="text-muted-foreground text-xs">
                  {t("menu.startWorkHint")}
                </span>
              </span>
            </DropdownMenuItem>
          )}
          {moveTargets.map((column) => (
            <DropdownMenuItem
              key={column.id}
              onClick={() => actions.onMove(card.key, column.id)}
            >
              <span className="flex flex-col items-start">
                {t("menu.moveTo", {
                  column: columnLabel(column, board.columnMapping, t),
                })}
                <span className="text-muted-foreground text-xs">
                  {t("menu.moveHint")}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
          {heuristic && !isDone ? (
            doneAllowed ? (
              <DropdownMenuItem
                onClick={() => actions.onMove(card.key, "done")}
              >
                {t("menu.moveToDone")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                <span className="flex flex-col items-start">
                  {t("menu.moveToDone")}
                  <span className="text-muted-foreground text-xs">
                    {t("menu.moveToDoneHint")}
                  </span>
                </span>
              </DropdownMenuItem>
            )
          ) : null}
        </DropdownMenuGroup>
        {canClose || canPrune ? <DropdownMenuSeparator /> : null}
        {canClose || canPrune ? (
          <DropdownMenuGroup>
            {canClose ? (
              <DropdownMenuItem
                onClick={() => actions.onConfirmDone(card.key)}
                variant="destructive"
              >
                {t("menu.closeInTracker")}
              </DropdownMenuItem>
            ) : null}
            {canPrune ? (
              <DropdownMenuItem
                onClick={() => actions.onPrune(card.key)}
                variant="destructive"
              >
                {t("menu.pruneWorktree")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
