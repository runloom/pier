import {
  Badge,
  Button,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Row,
  Text,
} from "pier/canvas";
import type { ReactNode } from "react";
import type { AppletChrome } from "./chrome.ts";
import { startReadyLabel, useCopy } from "./copy/index.ts";
import { INFO_BADGE_CLASS } from "./tracker-board/card.tsx";

export function TrackerMetaToolbar({
  canWrite,
  children,
  chrome = "island",
  columnMapping,
  cycleDetail,
  hasCycle,
  leadingExtra,
  onRefresh,
  onStartAllReady,
  readyCount,
  repo,
  truncated,
  updatedLabel,
}: {
  canWrite: boolean;
  children?: ReactNode | undefined;
  chrome?: AppletChrome | undefined;
  columnMapping?: "heuristic" | "project" | undefined;
  cycleDetail?: string | undefined;
  hasCycle?: boolean | undefined;
  leadingExtra?: ReactNode | undefined;
  onRefresh: () => void;
  onStartAllReady?: (() => void) | undefined;
  readyCount: number;
  repo?: string | undefined;
  truncated?: boolean | undefined;
  updatedLabel: string | null;
}) {
  const { t } = useCopy();
  const compact = chrome === "panel";
  const startReady = canWrite && onStartAllReady && readyCount > 0;
  const leading = (
    <>
      {compact || !repo ? null : (
        <Badge
          className={INFO_BADGE_CLASS}
          title={t("view.repoHint")}
          variant="ghost"
        >
          {repo}
        </Badge>
      )}
      {truncated ? (
        <Badge
          className={INFO_BADGE_CLASS}
          title={t("view.truncatedHint")}
          variant="neutral"
        >
          {t("view.truncated")}
        </Badge>
      ) : null}
      {compact || !columnMapping ? null : (
        <Badge
          className={INFO_BADGE_CLASS}
          title={t("view.columnsHint")}
          variant="ghost"
        >
          {columnMapping === "heuristic"
            ? t("view.columnsAssignment")
            : t("view.columnsProject")}
        </Badge>
      )}
      {canWrite ? null : (
        <Badge
          className={INFO_BADGE_CLASS}
          title={t("view.readOnlyHint")}
          variant="neutral"
        >
          {t("view.readOnly")}
        </Badge>
      )}
      {hasCycle ? (
        <HoverCard>
          <HoverCardTrigger asChild>
            <Badge className={INFO_BADGE_CLASS} variant="danger">
              {t("dag.cycle")}
            </Badge>
          </HoverCardTrigger>
          <HoverCardContent>{cycleDetail}</HoverCardContent>
        </HoverCard>
      ) : null}
      {leadingExtra}
    </>
  );
  const hasLeading =
    (!compact && Boolean(repo)) ||
    truncated ||
    (!compact && Boolean(columnMapping)) ||
    !canWrite ||
    hasCycle ||
    Boolean(leadingExtra);
  if (compact && !hasLeading && !children && !startReady) {
    return null;
  }
  if (compact && !truncated && canWrite && !hasCycle && !children && !startReady) {
    return null;
  }
  return (
    <Row
      className={
        compact
          ? "min-h-0 shrink-0 items-center py-0"
          : "min-h-11 shrink-0 items-center border-border/80 border-b py-1"
      }
      gap={8}
      justify="space-between"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">{leading}</div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {children}
        {compact || !updatedLabel ? null : (
          <Text as="span" tone="tertiary">
            {updatedLabel}
          </Text>
        )}
        {compact ? null : (
          <Button onClick={onRefresh} type="button" variant="outline">
            {t("view.refresh")}
          </Button>
        )}
        {startReady ? (
          <Button
            onClick={onStartAllReady}
            title={t("view.startReadyHint")}
            type="button"
          >
            {startReadyLabel(readyCount, t)}
          </Button>
        ) : null}
      </div>
    </Row>
  );
}
