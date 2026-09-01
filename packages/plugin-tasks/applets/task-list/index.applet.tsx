import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Row,
  Skeleton,
  Stack,
  Text,
  formatRelativeTime,
} from "pier/canvas";
import { Fragment, useMemo, useState } from "react";
import {
  appletBodyClass,
  appletChrome,
  appletRootClass,
} from "../chrome.ts";
import { columnLabel, useCopy } from "../copy/index.ts";
import { AppletLoadError, isTrackerAuthError } from "../load-error.tsx";
import { TrackerMetaToolbar } from "../toolbar.tsx";
import {
  AssigneeChip,
  CardActionsMenu,
  cycleLoopLabel,
  EdgeRefs,
  ISSUE_ID_CLASS,
  MENU_SLOT_PLACEHOLDER_CLASS,
  shortIssueKey,
  splitCycleRefs,
  TaskStatusBadges,
  taskCardDomId,
} from "../tracker-board/card.tsx";
import {
  firstColumnIdOfKind,
  isDoneColumn,
  isTodoColumn,
} from "../tracker-board/columns.ts";
import {
  type TaskColumnId,
  type TrackerBoardProps,
  useTrackerBoard,
} from "../tracker-board/hooks.ts";
import { ColumnHeader } from "../tracker-board/view.tsx";

export default function TaskListApplet(props: TrackerBoardProps) {
  const { locale, t } = useCopy();
  const board = useTrackerBoard(props);
  const snapshot = board.board;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const cards = useMemo(
    () => snapshot?.columns.flatMap((column) => column.items) ?? [],
    [snapshot]
  );

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Write failures must be visible; optimistic state already rolls back.
  const runAction = (work: Promise<unknown>) => {
    work
      .then(() => {
        setActionError(null);
      })
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : String(error));
      });
  };

  const moveSelected = (columnId: TaskColumnId) => {
    for (const key of selected) {
      runAction(board.moveCard(key, columnId));
    }
  };

  const alertMessage = board.error ?? actionError;
  const loading = board.status === "loading" && !snapshot;
  const cycleKeys = new Set(snapshot?.cycleKeys ?? []);
  const blocksByKey = new Map<string, string[]>();
  for (const item of cards) {
    for (const blocker of item.blockers ?? []) {
      blocksByKey.set(blocker.key, [
        ...(blocksByKey.get(blocker.key) ?? []),
        item.key,
      ]);
    }
  }
  // Refs without a row here render as inert muted text (underline = navigates).
  const listKnownKeys = new Set(cards.map((item) => item.key));
  const readyCount =
    snapshot?.columns
      .filter((column) => isTodoColumn(column))
      .flatMap((column) => column.items)
      .filter(
        (item) =>
          item.openBlockedByCount === 0 &&
          !item.work &&
          !cycleKeys.has(item.key)
      ).length ?? 0;
  const rowActions = {
    onConfirmDone: (itemKey: string) => {
      const doneId =
        firstColumnIdOfKind(snapshot?.columns ?? [], "done") ?? "done";
      runAction(board.moveCard(itemKey, doneId, true));
    },
    onFocusWork: (panelId: string) => {
      runAction(board.focusWork(panelId));
    },
    onMove: (itemKey: string, columnId: TaskColumnId) => {
      runAction(board.moveCard(itemKey, columnId));
    },
    onOpenIssue: (url: string) => {
      runAction(board.openIssue(url));
    },
    onPrune: (itemKey: string) => {
      runAction(board.pruneWork(itemKey));
    },
    onStartWork: (itemKey: string) => {
      runAction(board.startWork(itemKey));
    },
  };

  const chrome = appletChrome(props, "island");
  return (
    <Stack
      className={appletRootClass(chrome)}
      fill={chrome === "panel"}
      gap={chrome === "panel" ? 0 : 16}
    >
      {chrome === "panel" ? (
        snapshot?.canWrite && selected.size > 0 ? (
          <Row className="px-2 py-1" gap={8} justify="end">
            <Text as="span" tone="tertiary">
              {t("view.selected", { count: selected.size })}
            </Text>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="xs" type="button" variant="ghost">
                  {t("view.moveSelected")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuGroup>
                  {snapshot.columns
                    .filter((column) => column.id !== "done")
                    .map((column) => (
                      <DropdownMenuItem
                        key={column.id}
                        onClick={() => {
                          moveSelected(column.id);
                        }}
                      >
                        {columnLabel(column, snapshot.columnMapping, t)}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Row>
        ) : null
      ) : (
        <TrackerMetaToolbar
          canWrite={snapshot?.canWrite !== false}
          chrome={chrome}
          columnMapping={snapshot?.columnMapping}
          onRefresh={() => {
            runAction(board.refresh());
          }}
          onStartAllReady={() => {
            runAction(board.startAllReady());
          }}
          readyCount={readyCount}
          repo={snapshot ? props.repo : undefined}
          truncated={snapshot?.truncated === true}
          updatedLabel={
            snapshot
              ? t("view.updated", {
                  time: formatRelativeTime(
                    snapshot.fetchedAt,
                    Date.now(),
                    locale
                  ),
                })
              : null
          }
        >
          {snapshot?.canWrite && selected.size > 0 ? (
            <Text as="span" tone="tertiary">
              {t("view.selected", { count: selected.size })}
            </Text>
          ) : null}
          {snapshot?.canWrite && selected.size > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button">{t("view.moveSelected")}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuGroup>
                  {snapshot.columns
                    .filter((column) => column.id !== "done")
                    .map((column) => (
                      <DropdownMenuItem
                        key={column.id}
                        onClick={() => {
                          moveSelected(column.id);
                        }}
                      >
                        {columnLabel(column, snapshot.columnMapping, t)}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </TrackerMetaToolbar>
      )}
      {alertMessage && !snapshot ? (
        <AppletLoadError
          detail={alertMessage}
          hint={t("view.loadBoardHint")}
          onReconnect={
            isTrackerAuthError(alertMessage)
              ? () => {
                  runAction(board.reconnect());
                }
              : undefined
          }
          onRetry={() => {
            runAction(board.refresh());
          }}
          reconnectLabel={t("view.reconnect")}
          retryLabel={t("view.retry")}
          title={t("view.loadListFailed")}
        />
      ) : null}
      {alertMessage && snapshot ? (
        <Alert variant="destructive">
          <AlertTitle>{t("view.loadListFailed")}</AlertTitle>
          <AlertDescription>{t("view.loadBoardHint")}</AlertDescription>
        </Alert>
      ) : null}
      {loading ? (
        <Stack gap={8}>
          <Skeleton className="h-3 w-16 rounded-sm" />
          <Skeleton className="h-3 w-full rounded-sm" />
          <Skeleton className="h-3 w-5/6 rounded-sm" />
          <Skeleton className="h-3 w-2/3 rounded-sm" />
        </Stack>
      ) : null}
      <Stack
        className={
          chrome === "panel"
            ? "min-h-0 flex-1 overflow-auto px-2 py-2"
            : appletBodyClass(chrome)
        }
        gap={chrome === "panel" ? 10 : 14}
      >
        {snapshot?.columns
          .filter((column) => column.items.length > 0)
          .map((column) => (
            <Stack gap={4} key={column.id}>
              <ColumnHeader
                count={column.items.length}
                id={column.id}
                kind={column.kind}
                label={columnLabel(column, snapshot.columnMapping, t)}
              />
              <div className="overflow-hidden rounded-lg border border-border/60 bg-card shadow-2xs">
                <div>
                  {column.items.map((card) => {
                    const merged = card.linkedPRs.some((pr) => pr.merged);
                    const checked = selected.has(card.key);
                    const inCycle = cycleKeys.has(card.key);
                    const refs = splitCycleRefs({
                      blockers: (card.blockers ?? []).map(
                        (blocker) => blocker.key
                      ),
                      blocks: inCycle
                        ? (blocksByKey.get(card.key) ?? [])
                        : [],
                      inCycle,
                    });
                    return (
                      <div
                        className="group flex h-8.5 items-center justify-between gap-3 px-3 border-b border-border/30 last:border-b-0 hover:bg-muted/40 transition-colors cursor-pointer text-xs"
                        data-tracker-list-row=""
                        id={taskCardDomId("list", card.key)}
                        key={card.key}
                        onClick={(event) => {
                          const target = event.target;
                          const el =
                            target instanceof Element
                              ? target
                              : target instanceof Node
                                ? target.parentElement
                                : null;
                          if (el?.closest("button, a, [role=checkbox]")) {
                            return;
                          }
                          runAction(board.openIssue(card.url));
                        }}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) {
                            return;
                          }
                          if (event.key !== "Enter" && event.key !== " ") {
                            return;
                          }
                          event.preventDefault();
                          runAction(board.openIssue(card.url));
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          {snapshot?.canWrite ? (
                            <Checkbox
                              aria-label={t("view.selectCard", {
                                key: card.key,
                              })}
                              checked={checked}
                              onCheckedChange={() => {
                                toggle(card.key);
                              }}
                            />
                          ) : (
                            <span aria-hidden className="size-4 shrink-0" />
                          )}
                          <span className="w-13 shrink-0">
                            <Button
                              className={ISSUE_ID_CLASS}
                              data-board-issue-id=""
                              onClick={(e) => {
                                e.stopPropagation();
                                runAction(board.openIssue(card.url));
                              }}
                              title={t("edge.openIssue", {
                                key: card.key,
                              })}
                              type="button"
                              variant="link"
                            >
                              {shortIssueKey(card.key)}
                            </Button>
                          </span>
                          <span
                            className={
                              column.id === "done"
                                ? "min-w-0 truncate font-medium text-muted-foreground"
                                : "min-w-0 truncate font-medium text-foreground"
                            }
                            title={card.title}
                          >
                            {card.title}
                          </span>
                          {card.labels && card.labels.length > 0 ? (
                            <span className="hidden sm:inline-flex items-center gap-1 shrink-0">
                              {card.labels.slice(0, 2).map((label) => (
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
                                  <span className="truncate max-w-20">{label.name}</span>
                                </span>
                              ))}
                            </span>
                          ) : null}
                          <span className="min-w-0 truncate text-muted-foreground">
                            <EdgeRefs
                              keys={refs.cycleWith}
                              known={listKnownKeys}
                              label={t("edge.cycleWith")}
                              ownKey={card.key}
                              scope="list"
                              trailingSep={refs.blockedBy.length > 0}
                            />
                            <EdgeRefs
                              keys={refs.blockedBy}
                              known={listKnownKeys}
                              label={t("edge.blockedBy")}
                              ownKey={card.key}
                              scope="list"
                            />
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {card.assignee ? (
                            <AssigneeChip
                              avatarUrl={card.assignee.avatarUrl}
                              login={card.assignee.login}
                            />
                          ) : null}
                          <TaskStatusBadges
                            activity={
                              card.work?.panelId
                                ? (board.activityByPanel.get(
                                    card.work.panelId
                                  ) ?? null)
                                : null
                            }
                            blocked={
                              inCycle
                                ? refs.blockedBy.length > 0
                                : card.openBlockedByCount > 0
                            }
                            blockedDetail={(card.blockers ?? [])
                              .map(
                                (blocker) => blocker.title ?? blocker.key
                              )
                              .join(" · ")}
                            cycleDetail={cycleLoopLabel(
                              snapshot?.cycleKeys ?? [],
                              t
                            )}
                            inCycle={inCycle}
                            merged={merged}
                            mutedMerged={isDoneColumn(column)}
                            onFocusWork={rowActions.onFocusWork}
                            panelId={card.work?.panelId}
                            ready={
                              isTodoColumn(column) &&
                              card.openBlockedByCount === 0 &&
                              !cycleKeys.has(card.key)
                            }
                            suppressReady={Boolean(snapshot?.canWrite)}
                            workPath={card.work?.path}
                          />
                          {snapshot?.canWrite ? (
                            <span data-board-card-menu="">
                              <CardActionsMenu
                                actions={rowActions}
                                board={snapshot}
                                card={card}
                                columnId={column.id}
                                size="icon-xs"
                                triggerClassName="size-4.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 flex items-center justify-center text-[10px] leading-none transition-colors"
                              />
                            </span>
                          ) : (
                            <span
                              aria-hidden
                              className={MENU_SLOT_PLACEHOLDER_CLASS}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Stack>
          ))}
        {loading || cards.length !== 0 ? null : (
          <Empty className="min-h-0 flex-1">
            <EmptyHeader>
              <EmptyTitle>{t("view.emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("view.emptyBody")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </Stack>
    </Stack>
  );
}
