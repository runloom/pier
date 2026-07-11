import type {
  AppQuitConfirmationRequest,
  AppQuitDecisionPayload,
  QuitActivitySummary,
} from "@shared/contracts/app-quit.ts";
import type { TFunction } from "i18next";
import { useEffect, useRef } from "react";
import { useCommittedValue } from "@/hooks/use-committed-ref.ts";
import { useT } from "@/i18n/use-t.ts";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";

const MAX_VISIBLE_ACTIVITY_NAMES = 3;
const MAX_ACTIVITY_NAME_LENGTH = 72;

function truncateActivityName(name: string): string {
  if (name.length <= MAX_ACTIVITY_NAME_LENGTH) {
    return name;
  }

  return `${name.slice(0, MAX_ACTIVITY_NAME_LENGTH - 1)}…`;
}

function formatActivityName(
  t: TFunction,
  summary: QuitActivitySummary
): string {
  return truncateActivityName(
    t("dialog.appQuit.activityName", {
      kind: t(`dialog.appQuit.activityKind.${summary.kind}`),
      label: summary.label,
    })
  );
}

function formatActivityList(
  t: TFunction,
  summaries: readonly QuitActivitySummary[]
): string {
  const visibleSummaries = summaries.slice(0, MAX_VISIBLE_ACTIVITY_NAMES);
  const activities = visibleSummaries
    .map((summary) => formatActivityName(t, summary))
    .join(t("dialog.appQuit.activitySeparator"));
  const hiddenCount = summaries.length - visibleSummaries.length;

  if (hiddenCount <= 0) {
    return activities;
  }

  return t("dialog.appQuit.activityListWithOverflow", {
    activities,
    count: hiddenCount,
  });
}

function formatQuitDialogBody(
  t: TFunction,
  summaries: readonly QuitActivitySummary[]
): string {
  if (summaries.length === 0) {
    return t("dialog.appQuit.noActivityDetail");
  }

  const firstSummary = summaries[0];
  if (summaries.length === 1 && firstSummary) {
    return t("dialog.appQuit.singleActivityDetail", {
      activity: formatActivityName(t, firstSummary),
    });
  }

  return t("dialog.appQuit.multipleActivityDetail", {
    activities: formatActivityList(t, summaries),
  });
}

function toDecisionPayload(
  quitId: string,
  decision: AppQuitDecisionPayload["decision"]
): AppQuitDecisionPayload {
  return { decision, quitId };
}

export function AppQuitDialogBridge() {
  const t = useT();
  const currentQuitIdRef = useRef<string | null>(null);
  const readT = useCommittedValue(t);

  useEffect(() => {
    function sendDecision(
      quitId: string,
      decision: AppQuitDecisionPayload["decision"]
    ): void {
      window.pier.appQuit
        .decide(toDecisionPayload(quitId, decision))
        .catch((error: unknown) => {
          console.error(
            "[app-quit] failed to send renderer decision:",
            error instanceof Error ? error.message : String(error)
          );
        });
    }

    async function showRequest(
      request: AppQuitConfirmationRequest
    ): Promise<void> {
      const previousQuitId = currentQuitIdRef.current;
      if (previousQuitId && previousQuitId !== request.quitId) {
        sendDecision(previousQuitId, "cancel");
      }
      currentQuitIdRef.current = request.quitId;

      const confirmed = await showAppConfirm({
        title: readT()("dialog.appQuit.title"),
        body: formatQuitDialogBody(readT(), request.summaries),
        cancelLabel: readT()("dialog.appQuit.cancel"),
        confirmLabel: readT()("dialog.appQuit.quit"),
        intent: request.summaries.length > 0 ? "destructive" : "default",
        size: "sm",
      });

      if (currentQuitIdRef.current !== request.quitId) {
        return;
      }

      currentQuitIdRef.current = null;
      sendDecision(request.quitId, confirmed ? "quit" : "cancel");
    }

    return window.pier.appQuit.onRequested((request) => {
      showRequest(request).catch((error: unknown) => {
        console.error(
          "[app-quit] failed to show renderer confirmation:",
          error instanceof Error ? error.message : String(error)
        );
      });
    });
  }, [readT]);

  return null;
}
