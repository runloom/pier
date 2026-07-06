import type {
  AppQuitConfirmationRequest,
  AppQuitDecisionPayload,
  QuitActivitySummary,
} from "@shared/contracts/app-quit.ts";
import type { TFunction } from "i18next";
import { useEffect, useRef } from "react";
import { useT } from "@/i18n/use-t.ts";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";

const MAX_VISIBLE_ACTIVITIES = 8;
const MAX_DETAIL_LINE_LENGTH = 180;

function truncateDetailLine(line: string): string {
  if (line.length <= MAX_DETAIL_LINE_LENGTH) {
    return line;
  }

  return `${line.slice(0, MAX_DETAIL_LINE_LENGTH - 1)}…`;
}

function formatSummary(summary: QuitActivitySummary): string {
  const command = summary.commandLine ? ` — ${summary.commandLine}` : "";
  return `• ${summary.kind}: ${summary.label}${command}`;
}

function formatQuitDialogBody(
  t: TFunction,
  summaries: readonly QuitActivitySummary[]
): string {
  if (summaries.length === 0) {
    return t("dialog.appQuit.noActivityDetail");
  }

  const visibleSummaries = summaries.slice(0, MAX_VISIBLE_ACTIVITIES);
  const lines = [
    t("dialog.appQuit.activityMessage", { count: summaries.length }),
    ...visibleSummaries.map((summary) =>
      truncateDetailLine(formatSummary(summary))
    ),
  ];

  if (summaries.length > MAX_VISIBLE_ACTIVITIES) {
    lines.push(
      t("dialog.appQuit.overflow", {
        count: summaries.length - MAX_VISIBLE_ACTIVITIES,
      })
    );
  }

  lines.push(t("dialog.appQuit.activityDetailSuffix"));

  return lines.join("\n");
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
  const tRef = useRef(t);
  tRef.current = t;

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
        body: formatQuitDialogBody(tRef.current, request.summaries),
        cancelLabel: tRef.current("dialog.appQuit.cancel"),
        confirmLabel: tRef.current("dialog.appQuit.quit"),
        title: tRef.current("dialog.appQuit.title"),
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
  }, []);

  return null;
}
