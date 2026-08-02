import { Button } from "@pier/ui/button.tsx";
import type { TerminalFocusRoutingDebugSnapshot } from "@shared/contracts/terminal/debug.ts";
import { ClipboardCopy } from "lucide-react";
import { useMemo, useState } from "react";
import { formatTerminalFocusTraceDump } from "@/lib/workspace/terminal-focus-trace.ts";

async function copyFocusDump(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function formatBasePanel(
  focusRouting: TerminalFocusRoutingDebugSnapshot
): string {
  if (focusRouting.basePanel.kind === "terminal") {
    return `terminal:${focusRouting.basePanel.panelId}`;
  }
  return "web";
}

/** Compact sticky-web dump under Routing State (ids + last events + copy). */
export function FocusRoutingSummary({
  focusRouting,
}: {
  focusRouting: TerminalFocusRoutingDebugSnapshot | undefined;
}) {
  const [copyLabel, setCopyLabel] = useState("Copy focus dump");
  const webRequestIdsText =
    focusRouting && focusRouting.webRequestIds.length > 0
      ? focusRouting.webRequestIds.join(", ")
      : "(none)";
  const recentFocus = useMemo(
    () => (focusRouting?.events ?? []).slice(-8).reverse(),
    [focusRouting?.events]
  );

  return (
    <div className="shrink-0 space-y-1 border-t px-3 py-2 font-mono text-xs">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-muted-foreground">effective </span>
          {focusRouting?.effectiveKind ?? "—"}
          <span className="text-muted-foreground"> · base </span>
          {focusRouting ? formatBasePanel(focusRouting) : "—"}
        </div>
        <Button
          aria-label="Copy focus routing dump"
          onClick={() => {
            if (!focusRouting) {
              setCopyLabel("No data");
              window.setTimeout(() => setCopyLabel("Copy focus dump"), 1200);
              return;
            }
            copyFocusDump(formatTerminalFocusTraceDump(focusRouting))
              .then((ok) => {
                setCopyLabel(ok ? "Copied" : "Copy failed");
                window.setTimeout(() => setCopyLabel("Copy focus dump"), 1200);
              })
              .catch(() => undefined);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <ClipboardCopy data-icon="inline-start" />
          {copyLabel}
        </Button>
      </div>
      <div className="break-all">
        <span className="text-muted-foreground">webRequestIds </span>
        {webRequestIdsText}
      </div>
      {recentFocus.length > 0 ? (
        <ul className="max-h-24 space-y-0.5 overflow-auto text-muted-foreground">
          {recentFocus.map((event) => (
            <li key={event.seq}>
              <span className="font-semibold text-foreground">
                {event.kind}
              </span>
              {event.detail ? ` ${event.detail}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
