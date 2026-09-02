import {
  Badge,
  Button,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Row,
} from "pier/canvas";
import { useCopy } from "../copy/index.ts";
import type { CardActivityStatus } from "./hooks.ts";

/**
 * Agent states with a bound session are navigation, not state — so they use
 * the link grammar (colored solid underline + arrow), never a pill. Without a
 * session to jump to, they fall back to a plain state pill (no arrow).
 */
export function ActivityBadge({
  activity,
  onFocusWork,
  panelId,
}: {
  activity: CardActivityStatus;
  onFocusWork: (panelId: string) => void;
  panelId: string | undefined;
}) {
  const { t } = useCopy();
  if (!activity) {
    return null;
  }
  const label =
    activity === "waiting"
      ? t("badge.agentNeedsYou")
      : activity === "error"
        ? t("badge.agentStopped")
        : t("badge.agentWorking");
  if (!panelId) {
    return (
      <Badge
        variant={
          activity === "waiting"
            ? "warning"
            : activity === "error"
              ? "danger"
              : "info"
        }
      >
        {label}
      </Badge>
    );
  }
  const linkClass =
    activity === "waiting"
      ? "inline-flex cursor-pointer items-center gap-0.5 whitespace-nowrap rounded font-medium text-status-warning-fg text-xs underline decoration-solid underline-offset-2 outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring/40 hover:opacity-80"
      : activity === "error"
        ? "inline-flex cursor-pointer items-center gap-0.5 whitespace-nowrap rounded font-medium text-status-danger-fg text-xs underline decoration-solid underline-offset-2 outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring/40 hover:opacity-80"
        : "inline-flex cursor-pointer items-center gap-0.5 whitespace-nowrap rounded font-medium text-status-info-fg text-xs underline decoration-solid underline-offset-2 outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring/40 hover:opacity-80";
  return (
    <Button
      aria-label={t("badge.focusSessionAria")}
      className={linkClass}
      onClick={() => onFocusWork(panelId)}
      title={t("badge.focusSession")}
      type="button"
      variant="link"
    >
      {label}
      <span aria-hidden>→</span>
    </Button>
  );
}

/**
 * Identity of this card: opens the tracker. No rest-state underline — that
 * cue is reserved for in-view jump links (`ISSUE_LINK_CLASS`).
 */
export const ISSUE_ID_CLASS =
  "h-auto w-fit justify-start p-0 font-normal text-muted-foreground no-underline hover:text-foreground hover:no-underline";

/**
 * Text tokens that navigate in-view (blocker / cycle jumps) carry a
 * persistent muted underline — the rest-state cue that identity text lacks.
 */
export const ISSUE_LINK_CLASS =
  "h-auto p-0 font-normal text-muted-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground";

/** Hover-info chips share one cue: dotted underline + help cursor. */
export const INFO_BADGE_CLASS =
  "cursor-help underline decoration-dotted underline-offset-2";

const WORKING_TREE_CLASS =
  "cursor-help text-muted-foreground text-xs underline decoration-dotted underline-offset-2";

/**
 * One badge order on board, list, and graph: state pills, then context
 * chips, then the agent jump. Bands may suppress a chip that names themselves.
 */
export function TaskStatusBadges({
  activity,
  blocked,
  blockedDetail,
  cycleDetail,
  inCycle,
  merged,
  mutedMerged = false,
  onFocusWork,
  panelId,
  ready,
  suppressBlocked = false,
  suppressInCycle = false,
  suppressReady = false,
  workPath,
}: {
  activity: CardActivityStatus;
  blocked: boolean;
  blockedDetail?: string;
  cycleDetail?: string;
  inCycle: boolean;
  merged: boolean;
  mutedMerged?: boolean;
  onFocusWork: (panelId: string) => void;
  panelId: string | undefined;
  ready: boolean;
  suppressBlocked?: boolean;
  suppressInCycle?: boolean;
  suppressReady?: boolean;
  workPath?: string | undefined;
}) {
  const { t } = useCopy();
  const showReady = ready && !suppressReady;
  const showCycle = inCycle && !suppressInCycle;
  const showBlocked = blocked && !suppressBlocked;
  const showWorking = Boolean(workPath);
  if (
    !(
      showReady ||
      showCycle ||
      showBlocked ||
      merged ||
      showWorking ||
      Boolean(activity)
    )
  ) {
    return null;
  }
  return (
    <Row gap={6}>
      {showReady ? <Badge variant="success">{t("badge.ready")}</Badge> : null}
      {showCycle ? (
        <HoverCard>
          <HoverCardTrigger asChild>
            <Badge variant="danger">{t("badge.inCycle")}</Badge>
          </HoverCardTrigger>
          <HoverCardContent>
            {cycleDetail ?? t("badge.cycleHint")}
          </HoverCardContent>
        </HoverCard>
      ) : null}
      {showBlocked ? (
        <HoverCard>
          <HoverCardTrigger asChild>
            <Badge variant="neutral">{t("badge.blocked")}</Badge>
          </HoverCardTrigger>
          <HoverCardContent>
            {blockedDetail ?? t("badge.blockedHint")}
          </HoverCardContent>
        </HoverCard>
      ) : null}
      {merged ? (
        <Badge className={mutedMerged ? "opacity-70" : ""} variant="done">
          {t("badge.prMerged")}
        </Badge>
      ) : null}
      {showWorking ? (
        <span className={WORKING_TREE_CLASS} title={workPath}>
          {t("badge.workingTree")}
        </span>
      ) : null}
      <ActivityBadge
        activity={activity}
        onFocusWork={onFocusWork}
        panelId={panelId}
      />
    </Row>
  );
}
