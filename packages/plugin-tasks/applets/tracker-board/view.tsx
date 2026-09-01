import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
  Droppable,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Badge,
  Row,
  Skeleton,
  Sortable,
  Stack,
  Text,
  formatRelativeTime,
} from "pier/canvas";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type AppletChrome, appletRootClass } from "../chrome.ts";
import { columnLabel, useCopy } from "../copy/index.ts";
import { AppletLoadError, isTrackerAuthError } from "../load-error.tsx";
import { TrackerMetaToolbar } from "../toolbar.tsx";
import { cycleLoopLabel, TaskCardView } from "./card.tsx";
import { columnKindOf, isTodoColumn } from "./columns.ts";
import {
  type CardActivityStatus,
  type TaskBoardModel,
  type TaskCardModel,
  type TaskColumnId,
} from "./hooks.ts";
import { largestIndexMove } from "./sort-order.ts";

export interface TrackerBoardActions {
  onConfirmDone: (itemKey: string) => void;
  onFocusWork: (panelId: string) => void;
  onMove: (itemKey: string, columnId: TaskColumnId, index?: number) => void;
  onOpenIssue: (url: string) => void;
  onPrune: (itemKey: string) => void;
  onReconnect: () => void;
  onRefresh: () => void;
  onStartAllReady: () => void;
  onStartWork: (itemKey: string) => void;
}

const COLUMN_SHELL_CLASS =
  "min-h-0 min-w-0 bg-muted/30 border border-border/30 rounded-lg flex flex-col gap-2";
const BOARD_GRID_CLASS = "min-h-0 min-w-0 flex-1";
const BOARD_NARROW_PX = 600;

function PulseLines() {
  return (
    <div className="flex flex-col gap-2 pr-2">
      <Skeleton className="h-3 w-4/5 rounded-sm" />
      <Skeleton className="h-3 w-3/5 rounded-sm" />
    </div>
  );
}

function ColumnScroll({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-0 flex-1"
      data-scrollbar="stable"
      data-tracker-column-scroll=""
    >
      {children}
    </div>
  );
}

function BoardGrid({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Split views are the common case; first paint should not crush cards.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const update = () => {
      setNarrow(el.clientWidth < BOARD_NARROW_PX);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div
      className={BOARD_GRID_CLASS}
      data-tracker-board=""
      data-tracker-narrow={narrow ? "" : undefined}
      ref={ref}
    >
      {children}
    </div>
  );
}

export function ColumnStatusIcon({
  id,
}: {
  id: "todo" | "inProgress" | "done" | "canceled" | string;
}) {
  if (id === "canceled") {
    return (
      <svg
        aria-hidden
        className="size-3 shrink-0 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        viewBox="0 0 16 16"
      >
        <circle cx="8" cy="8" r="5.5" />
        <path d="M5.5 5.5 10.5 10.5M10.5 5.5 5.5 10.5" />
      </svg>
    );
  }
  if (id === "inProgress") {
    return (
      <svg
        aria-hidden
        className="size-3 shrink-0 text-status-warning-fg"
        fill="currentColor"
        viewBox="0 0 16 16"
      >
        <path d="M8 2a6 6 0 1 0 6 6A6 6 0 0 0 8 2Zm0 10.2A4.2 4.2 0 0 1 8 3.8v8.4Z" />
      </svg>
    );
  }
  if (id === "done") {
    return (
      <svg
        aria-hidden
        className="size-3 shrink-0 text-status-success-fg"
        fill="currentColor"
        viewBox="0 0 16 16"
      >
        <circle
          cx="8"
          cy="8"
          fill="none"
          r="6.5"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          clipRule="evenodd"
          d="M11.354 5.646a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708 0l-2-2a.5.5 0 1 1 .708-.708L7 9.293l3.646-3.647a.5.5 0 0 1 .708 0Z"
          fillRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden
      className="size-3 shrink-0 text-muted-foreground/80"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      viewBox="0 0 16 16"
    >
      <circle cx="8" cy="8" r="5.5" strokeDasharray="3.5 2.5" />
    </svg>
  );
}

export function ColumnHeader({
  count,
  id,
  kind,
  label,
}: {
  count?: number;
  id: string;
  kind?: string;
  label: string;
}) {
  return (
    <Row className="h-6 shrink-0 pr-2" gap={6} wrap={false}>
      <ColumnStatusIcon id={columnKindOf({ id, kind })} />
      <Text as="span" className="min-w-0 flex-1 truncate text-xs">
        {label}
      </Text>
      {count === undefined ? null : (
        <Badge size="xs" variant="secondary">
          {count}
        </Badge>
      )}
    </Row>
  );
}

export function TrackerBoardView({
  actions,
  activityByPanel,
  board,
  chrome,
  error,
  repo,
  status,
}: {
  actions: TrackerBoardActions;
  activityByPanel: Map<string, CardActivityStatus>;
  board: TaskBoardModel | null;
  chrome: AppletChrome;
  error: string | null;
  repo?: string | undefined;
  status: "error" | "loading" | "ready";
}) {
  const { locale, t } = useCopy();
  const fetchedLabel = board
    ? t("view.updated", {
        time: formatRelativeTime(board.fetchedAt, Date.now(), locale),
      })
    : status === "loading"
      ? t("view.loadingBoard")
      : null;
  const cycleKeys = new Set(board?.cycleKeys ?? []);
  const readyCount =
    board?.columns
      .filter((column) => isTodoColumn(column))
      .flatMap((column) => column.items)
      .filter(
        (item) =>
          item.openBlockedByCount === 0 &&
          !item.work &&
          !cycleKeys.has(item.key)
      ).length ?? 0;

  return (
    <Stack
      className={appletRootClass(chrome)}
      fill={chrome === "panel"}
      gap={chrome === "panel" ? 0 : 16}
    >
      {chrome === "panel" ? null : (
        <TrackerMetaToolbar
          canWrite={board?.canWrite !== false}
          chrome={chrome}
          columnMapping={board?.columnMapping}
          cycleDetail={cycleLoopLabel(board?.cycleKeys ?? [], t)}
          hasCycle={board?.hasCycle === true}
          onRefresh={actions.onRefresh}
          onStartAllReady={actions.onStartAllReady}
          readyCount={readyCount}
          repo={board || error ? repo : undefined}
          truncated={board?.truncated === true}
          updatedLabel={fetchedLabel}
        />
      )}

      {error && !board ? (
        <AppletLoadError
          detail={error}
          hint={t("view.loadBoardHint")}
          onReconnect={
            isTrackerAuthError(error) ? actions.onReconnect : undefined
          }
          onRetry={actions.onRefresh}
          reconnectLabel={t("view.reconnect")}
          retryLabel={t("view.retry")}
          title={t("view.loadBoardFailed")}
        />
      ) : null}
      {error && board ? (
        <Alert variant="destructive">
          <AlertTitle>{t("view.loadBoardFailed")}</AlertTitle>
          <AlertDescription>{t("view.loadBoardHint")}</AlertDescription>
          <AlertAction className="flex items-center gap-2">
            <Button onClick={actions.onRefresh} type="button">
              {t("view.retry")}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {board || status === "loading" || error ? null : (
        <Empty className="flex-1 items-start justify-start border-none p-4 text-left">
          <EmptyHeader className="items-start text-left">
            <EmptyTitle>{t("view.emptyTitle")}</EmptyTitle>
            <EmptyDescription className="max-w-none">
              {t("view.emptyBody")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {board || status !== "loading" ? null : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2">
          <PulseLines />
        </div>
      )}

      {board ? (
        <BoardGrid>
          {board.columns.map((column) => {
            const ids = column.items.map((item) => item.key);
            const allowDrag = board.canWrite;
            return (
              <Droppable
                className={COLUMN_SHELL_CLASS}
                id={column.id}
                key={column.id}
                onDrop={(itemId) => {
                  actions.onMove(itemId, column.id);
                }}
              >
                <ColumnHeader
                  count={ids.length}
                  id={column.id}
                  kind={column.kind}
                  label={columnLabel(column, board.columnMapping, t)}
                />
                {allowDrag ? (
                  <ColumnScroll>
                  <Sortable
                    className="min-h-0"
                    items={ids}
                    onDropItem={(itemId, index) => {
                      actions.onMove(itemId, column.id, index);
                    }}
                    onReorder={(nextIds) => {
                      const moved = largestIndexMove(ids, nextIds);
                      if (!moved) {
                        return;
                      }
                      actions.onMove(moved.key, column.id, moved.index);
                    }}
                    reorderable={board.capabilities?.persistRank === true}
                  >
                    {(itemId) => {
                      const card = column.items.find(
                        (row) => row.key === itemId
                      );
                      if (!card) {
                        return null;
                      }
                      return renderCard(
                        board,
                        column.id,
                        card,
                        activityByPanel,
                        cycleKeys,
                        actions
                      );
                    }}
                  </Sortable>
                  </ColumnScroll>
                ) : (
                  <ColumnScroll>
                  <Stack className="min-h-0" gap={4}>
                    {column.items.map((card) =>
                      renderCard(
                        board,
                        column.id,
                        card,
                        activityByPanel,
                        cycleKeys,
                        actions
                      )
                    )}
                  </Stack>
                  </ColumnScroll>
                )}
              </Droppable>
            );
          })}
        </BoardGrid>
      ) : null}
    </Stack>
  );
}

function renderCard(
  board: TaskBoardModel,
  columnId: TaskColumnId,
  card: TaskCardModel,
  activityByPanel: Map<string, CardActivityStatus>,
  cycleKeys: ReadonlySet<string>,
  actions: TrackerBoardActions
) {
  const panelId = card.work?.panelId;
  // Downstream refs let cycle members show the loop in both directions.
  const blocks = board.columns
    .flatMap((column) => column.items)
    .filter((item) =>
      (item.blockers ?? []).some((blocker) => blocker.key === card.key)
    )
    .map((item) => item.key);
  return (
    <TaskCardView
      activity={panelId ? (activityByPanel.get(panelId) ?? null) : null}
      blocks={blocks}
      board={board}
      card={card}
      columnId={columnId}
      inCycle={cycleKeys.has(card.key)}
      key={card.key}
      onConfirmDone={actions.onConfirmDone}
      onFocusWork={actions.onFocusWork}
      onMove={actions.onMove}
      onOpenIssue={actions.onOpenIssue}
      onPrune={actions.onPrune}
      onStartWork={actions.onStartWork}
    />
  );
}
