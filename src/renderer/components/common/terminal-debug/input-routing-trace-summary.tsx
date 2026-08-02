import { Button } from "@pier/ui/button.tsx";
import type {
  TerminalInputRoutingTraceEvent,
  TerminalInputRoutingTraceSnapshot,
} from "@shared/contracts/terminal/debug.ts";
import { ClipboardCopy, ListTree } from "lucide-react";
import { useMemo, useState } from "react";
import {
  formatTerminalInputRoutingTraceDump,
  formatTerminalInputRoutingTraceFields,
} from "@/lib/terminal-debug/input-routing-trace.ts";

async function copyInputRoutingTrace(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function eventSummary(event: TerminalInputRoutingTraceEvent): string {
  return [event.action, ...formatTerminalInputRoutingTraceFields(event)].join(
    " · "
  );
}

/** 调试窗口内最近的输入路由轨迹（拖拽 / 快捷键 / owner-stuck）。 */
export function InputRoutingTraceSummary({
  trace,
}: {
  trace: TerminalInputRoutingTraceSnapshot | undefined;
}) {
  const [copyLabel, setCopyLabel] = useState("Copy input trace");
  const recentEvents = useMemo(
    () => (trace?.events ?? []).slice(-12).reverse(),
    [trace?.events]
  );

  return (
    <section className="flex shrink-0 flex-col border-t bg-card">
      <div className="flex h-9 items-center gap-2 border-b bg-muted px-3">
        <ListTree className="size-4 text-muted-foreground" />
        <div className="font-semibold text-sm">Input Routing Trace</div>
        <div className="ml-auto text-muted-foreground text-xs">
          {trace?.events.length ?? 0} events
        </div>
        <Button
          aria-label="Copy input trace"
          onClick={() => {
            if (!trace) {
              setCopyLabel("No data");
              window.setTimeout(() => setCopyLabel("Copy input trace"), 1200);
              return;
            }
            copyInputRoutingTrace(formatTerminalInputRoutingTraceDump(trace))
              .then((ok) => {
                setCopyLabel(ok ? "Copied" : "Copy failed");
                window.setTimeout(() => setCopyLabel("Copy input trace"), 1200);
              })
              .catch(() => undefined);
          }}
          type="button"
          variant="outline"
        >
          <ClipboardCopy data-icon="inline-start" />
          {copyLabel}
        </Button>
      </div>
      {recentEvents.length === 0 ? (
        <div className="px-3 py-2 text-muted-foreground text-xs">
          No input-routing events yet.
        </div>
      ) : (
        <ul className="max-h-40 divide-y divide-border overflow-auto font-mono text-xs">
          {recentEvents.map((event) => (
            <li className="flex gap-2 px-3 py-1.5" key={event.seq}>
              <span className="shrink-0 text-muted-foreground">
                #{event.seq}
              </span>
              <span className="shrink-0 font-semibold text-foreground">
                {event.source}
              </span>
              <span className="min-w-0 break-all text-muted-foreground">
                {eventSummary(event)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
