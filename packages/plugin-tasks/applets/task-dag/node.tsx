import {
  Button,
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Row,
} from "pier/canvas";
import {
  AssigneeChip,
  CardActionsMenu,
  type CardMenuActions,
  cycleLoopLabel,
  EdgeRefs,
  ISSUE_ID_CLASS,
  MENU_SLOT_PLACEHOLDER_CLASS,
  shortIssueKey,
  splitCycleRefs,
  TaskStatusBadges,
  taskCardDomId,
} from "../tracker-board/card.tsx";
import { useCopy } from "../copy/index.ts";
import type {
  CardActivityStatus,
  TaskBoardModel,
  TaskCardModel,
} from "../tracker-board/hooks.ts";
import { columnIdForCard, type DagSectionId } from "./bands.ts";

export function DagNodeCard({
  activityByPanel,
  blockedBy,
  blocks,
  board,
  card,
  cardActions,
  cycleKeys,
  isDone,
  knownKeys,
  nodeKey,
  sectionId,
  title,
}: {
  activityByPanel: ReadonlyMap<string, CardActivityStatus>;
  blockedBy: readonly string[];
  blocks: readonly string[];
  board: TaskBoardModel | null;
  card: TaskCardModel | undefined;
  cardActions: CardMenuActions;
  cycleKeys: ReadonlySet<string>;
  isDone: boolean;
  knownKeys: ReadonlySet<string>;
  nodeKey: string;
  sectionId: DagSectionId;
  title: string;
}) {
  const inCycle = cycleKeys.has(nodeKey);
  const working = Boolean(card?.work);
  const ready = !(
    isDone ||
    working ||
    inCycle ||
    blockedBy.length > 0
  );
  const merged = Boolean(card?.linkedPRs.some((pr) => pr.merged));
  const refs = splitCycleRefs({
    blockers: blockedBy,
    blocks,
    inCycle,
  });
  const hasRefs =
    refs.cycleWith.length > 0 ||
    refs.blockedBy.length > 0 ||
    refs.blocks.length > 0;
  const columnId = columnIdForCard(board, nodeKey);
  const { t } = useCopy();
  return (
    <Item
      className={
        inCycle
          ? "w-[28rem] items-start bg-card outline-none ring-1 ring-destructive/60 transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
          : "w-[28rem] items-start bg-card outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
      }
      id={taskCardDomId("dag", nodeKey)}
      tabIndex={0}
      variant="outline"
    >
      <ItemContent>
        <Row
          align="flex-start"
          className="-mb-1 min-h-7"
          justify="space-between"
          wrap={false}
        >
          <ItemTitle
            className={
              isDone
                ? "line-clamp-2 min-w-0 text-muted-foreground"
                : "line-clamp-2 min-w-0"
            }
            title={title}
          >
            {title}
          </ItemTitle>
          {card && board?.canWrite ? (
            <CardActionsMenu
              actions={cardActions}
              board={board}
              card={card}
              columnId={columnId}
            />
          ) : (
            <span aria-hidden className={MENU_SLOT_PLACEHOLDER_CLASS} />
          )}
        </Row>
        <ItemDescription>
          <span className="whitespace-nowrap">
            <Button
              className={ISSUE_ID_CLASS}
              onClick={() => {
                if (card) {
                  cardActions.onOpenIssue(card.url);
                }
              }}
              title={t("edge.openIssue", { key: nodeKey })}
              type="button"
              variant="link"
            >
              {shortIssueKey(nodeKey)}
            </Button>
            {card?.assignee || hasRefs ? " ·" : ""}
          </span>
          {card?.assignee ? (
            <>
              {" "}
              <span className="whitespace-nowrap">
                <AssigneeChip login={card.assignee.login} />
                {hasRefs ? " ·" : ""}
              </span>
            </>
          ) : null}
          <EdgeRefs
            keys={refs.cycleWith}
            known={knownKeys}
            label={t("edge.cycleWith")}
            ownKey={nodeKey}
            scope="dag"
            trailingSep={refs.blockedBy.length > 0 || refs.blocks.length > 0}
          />
          <EdgeRefs
            keys={refs.blockedBy}
            known={knownKeys}
            label={t("edge.blockedBy")}
            ownKey={nodeKey}
            scope="dag"
            trailingSep={refs.blocks.length > 0}
          />
          <EdgeRefs
            keys={refs.blocks}
            known={knownKeys}
            label={t("edge.blocks")}
            ownKey={nodeKey}
            scope="dag"
          />
        </ItemDescription>
        <TaskStatusBadges
          activity={
            card?.work?.panelId
              ? (activityByPanel.get(card.work.panelId) ?? null)
              : null
          }
          blocked={refs.blockedBy.length > 0}
          blockedDetail={t("badge.waitingOnKeys", {
            keys: refs.blockedBy.join(", "),
          })}
          cycleDetail={cycleLoopLabel([...cycleKeys], t)}
          inCycle={inCycle}
          merged={merged}
          mutedMerged={isDone}
          onFocusWork={cardActions.onFocusWork}
          panelId={card?.work?.panelId}
          ready={ready}
          suppressBlocked={sectionId === "waiting"}
          suppressInCycle={sectionId === "cycle"}
          suppressReady={sectionId === "ready"}
          workPath={card?.work?.path}
        />
      </ItemContent>
    </Item>
  );
}
