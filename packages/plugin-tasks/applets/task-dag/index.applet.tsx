import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Row,
  Separator,
  Skeleton,
  Stack,
  Text,
  formatRelativeTime,
} from "pier/canvas";
import { useState } from "react";
import {
  appletBodyClass,
  appletChrome,
  appletRootClass,
} from "../chrome.ts";
import { useCopy } from "../copy/index.ts";
import { AppletLoadError } from "../load-error.tsx";
import { TrackerMetaToolbar } from "../toolbar.tsx";
import {
  cycleLoopLabel,
  INFO_BADGE_CLASS,
} from "../tracker-board/card.tsx";
import {
  firstColumnIdOfKind,
  isTerminalColumn,
  isTodoColumn,
} from "../tracker-board/columns.ts";
import {
  type TaskCardModel,
  type TaskColumnId,
  type TrackerBoardProps,
  useTrackerBoard,
} from "../tracker-board/hooks.ts";
import { dagSectionLabel, dagSections } from "./bands.ts";
import { useTaskDag } from "./hooks.ts";
import { DAG_LAYOUT_CROSSING_EXIT, layerDagNodes } from "./layout.ts";
import { DagNodeCard } from "./node.tsx";

/**
 * Experimental layered DAG over the dag projection. Quality bar: if crossing
 * edges dominate, point people at the board or list instead of pretending the
 * layout is readable.
 */
export default function TaskDagApplet(props: TrackerBoardProps) {
  const { locale, t } = useCopy();
  const board = useTrackerBoard(props);
  const graph = useTaskDag(props);
  const [actionError, setActionError] = useState<string | null>(null);
  const runAction = (work: Promise<unknown>) => {
    work
      .then(() => {
        setActionError(null);
      })
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : String(error));
      });
  };

  const dag = graph.dag;
  const layout = layerDagNodes({
    edges: dag?.edges ?? [],
    nodes: dag?.nodes ?? [],
  });
  const overBudget = layout.crossings > DAG_LAYOUT_CROSSING_EXIT;
  const cycleKeys = new Set(dag?.cycleKeys ?? []);
  const knownKeys = new Set((dag?.nodes ?? []).map((node) => node.key));
  const blockersByKey = new Map<string, string[]>();
  const blocksByKey = new Map<string, string[]>();
  for (const edge of dag?.edges ?? []) {
    blockersByKey.set(edge.to, [
      ...(blockersByKey.get(edge.to) ?? []),
      edge.from,
    ]);
    blocksByKey.set(edge.from, [
      ...(blocksByKey.get(edge.from) ?? []),
      edge.to,
    ]);
  }
  const cardByKey = new Map<string, TaskCardModel>(
    (board.board?.columns ?? [])
      .flatMap((column) => column.items)
      .map((card) => [card.key, card])
  );
  const doneKeys = new Set(
    (board.board?.columns ?? [])
      .filter((column) => isTerminalColumn(column))
      .flatMap((column) => column.items.map((item) => item.key))
  );
  const builtSections = dagSections({
    cardByKey,
    cycleKeys,
    doneKeys,
    layers: layout.layers,
  });
  // The cycle is the most actionable band; keep it above the fold. Done sinks
  // to the bottom so live blocked layers stay adjacent to their blockers.
  const sections = [
    ...builtSections.filter((section) => section.id === "cycle"),
    ...builtSections.filter(
      (section) => section.id !== "cycle" && section.id !== "done"
    ),
    ...builtSections.filter((section) => section.id === "done"),
  ];
  const alertMessage = graph.error ?? board.error ?? actionError;
  const loading = graph.status === "loading" && !dag;
  const readyCount =
    board.board?.columns
      .filter((column) => isTodoColumn(column))
      .flatMap((column) => column.items)
      .filter(
        (item) =>
          item.openBlockedByCount === 0 &&
          !item.work &&
          !cycleKeys.has(item.key)
      ).length ?? 0;
  const chrome = appletChrome(props, "island");
  const cardActions = {
    onConfirmDone: (itemKey: string) => {
      const doneId =
        firstColumnIdOfKind(board.board?.columns ?? [], "done") ?? "done";
      runAction(board.moveCard(itemKey, doneId, true));
    },
    onFocusWork: (panelId: string) => {
      runAction(board.focusWork(panelId));
    },
    onMove: (itemKey: string, nextColumn: TaskColumnId) => {
      runAction(board.moveCard(itemKey, nextColumn));
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

  return (
    <Stack
      className={appletRootClass(chrome)}
      fill={chrome === "panel"}
      gap={16}
    >
      <TrackerMetaToolbar
        canWrite={board.board?.canWrite !== false}
        chrome={chrome}
        cycleDetail={cycleLoopLabel(dag?.cycleKeys ?? [], t)}
        hasCycle={dag?.hasCycle === true}
        leadingExtra={
          <Badge
            className={INFO_BADGE_CLASS}
            title={t("view.graphExperimentalHint")}
            variant="ghost"
          >
            {t("view.graphExperimental")}
          </Badge>
        }
        onRefresh={() => {
          runAction(board.refresh());
        }}
        onStartAllReady={() => {
          runAction(board.startAllReady());
        }}
        readyCount={readyCount}
        repo={dag ? props.repo : undefined}
        updatedLabel={
          dag
            ? t("view.updated", {
                time: formatRelativeTime(dag.fetchedAt, Date.now(), locale),
              })
            : null
        }
      />

      {alertMessage && !dag ? (
        <AppletLoadError
          detail={alertMessage}
          hint={t("view.loadBoardHint")}
          onRetry={() => {
            runAction(board.refresh());
          }}
          retryLabel={t("view.retry")}
          title={t("view.loadGraphFailed")}
        />
      ) : null}
      {alertMessage && dag ? (
        <Alert variant="destructive">
          <AlertTitle>{t("view.loadGraphFailed")}</AlertTitle>
          <AlertDescription>{t("view.loadBoardHint")}</AlertDescription>
        </Alert>
      ) : null}

      {overBudget ? (
        <Text as="p" tone="tertiary">
          {t("view.graphOverBudget")}
        </Text>
      ) : null}

      {loading ? (
        <Stack gap={8}>
          <Skeleton className="h-3 w-24 rounded-sm" />
          <Skeleton className="h-3 w-80 rounded-sm" />
          <Skeleton className="h-3 w-64 rounded-sm" />
        </Stack>
      ) : null}

      <Stack className={appletBodyClass(chrome)} gap={20}>
        {sections.map((section) => (
          <Stack
            className={
              // The danger band carries its scent structurally (left rail).
              // Negative margin keeps card left edges aligned across bands.
              section.danger
                ? "-ml-3 border-destructive/40 border-l-2 pl-2.5"
                : ""
            }
            gap={10}
            key={`${section.id}-${section.keys.join("|")}`}
          >
            {/* One group-header anatomy across board, list, and graph:
                label + adjacent count chip (the hairline is band layout). */}
            <Row gap={8} wrap={false}>
              <Text
                as="h3"
                className={section.danger ? "shrink-0 text-status-danger-fg" : "shrink-0"}
              >
                {dagSectionLabel(section, t)}
              </Text>
              <Badge className="rounded-full px-2 py-0" variant="secondary">
                {section.keys.length}
              </Badge>
              <Separator
                className={
                  section.danger ? "min-w-0 flex-1 bg-destructive/30" : "min-w-0 flex-1"
                }
              />
            </Row>
            <Row align="stretch" gap={12} wrap>
              {section.keys.map((key) => {
                const node = dag?.nodes.find((item) => item.key === key);
                if (!node) {
                  return null;
                }
                return (
                  <DagNodeCard
                    activityByPanel={board.activityByPanel}
                    blockedBy={blockersByKey.get(key) ?? []}
                    blocks={blocksByKey.get(key) ?? []}
                    board={board.board}
                    card={cardByKey.get(key)}
                    cardActions={cardActions}
                    cycleKeys={cycleKeys}
                    isDone={doneKeys.has(key)}
                    key={key}
                    knownKeys={knownKeys}
                    nodeKey={key}
                    sectionId={section.id}
                    title={node.title}
                  />
                );
              })}
            </Row>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}
