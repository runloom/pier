import type { NotificationReport } from "@shared/contracts/notification-center.ts";
import { resolveAttentionLocale } from "../services/agent-attention/locale.ts";
import {
  formatAgentCommandInjectFailedCopy,
  setAgentCommandInjectFailedReporter,
} from "./terminal/create-post-actions.ts";

export function wireAgentCommandInjectFailedReporter(
  ingest: (report: NotificationReport) => void
): void {
  setAgentCommandInjectFailedReporter((panelId) => {
    ingestAgentCommandInjectFailed(ingest, panelId).catch((err) => {
      console.error("[notification-center] inject-failed report failed:", err);
    });
  });
}

async function ingestAgentCommandInjectFailed(
  ingest: (report: NotificationReport) => void,
  panelId: string
): Promise<void> {
  let locale: "en" | "zh-CN" = "en";
  try {
    locale = await resolveAttentionLocale();
  } catch {
    locale = "en";
  }
  const copy = formatAgentCommandInjectFailedCopy(locale);
  ingest({
    body: copy.body,
    dedupeKey: `terminal:agent-inject-failed:${panelId}`,
    kind: "operation.result",
    panelRef: { panelId },
    severity: "error",
    source: "host",
    title: copy.title,
    titleKey: "workspace.addPanelMenu.startAgentFailed",
    trigger: "user-action",
  });
}
