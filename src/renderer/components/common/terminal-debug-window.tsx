import type {
  TerminalDebugEvent,
  TerminalDebugSnapshot,
} from "@shared/contracts/terminal.ts";
import {
  Activity,
  Columns3,
  Crosshair,
  GitBranch,
  MonitorDot,
  MousePointer2,
  RefreshCw,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { LayoutStateView } from "./terminal-debug-layout-view.tsx";

type DebugView = "layout" | "routing";
type RouteStatus = "bad" | "idle" | "ok" | "warn";

interface TerminalDebugWindowProps {
  targetBrowserWindowId: number;
}

interface RouteHealth {
  id: string;
  label: string;
  status: RouteStatus;
}

function statusClass(status: RouteStatus): string {
  if (status === "ok") {
    return "border-zinc-300 border-l-4 border-l-emerald-500 bg-white text-emerald-900";
  }
  if (status === "warn") {
    return "border-zinc-300 border-l-4 border-l-amber-500 bg-white text-amber-900";
  }
  if (status === "bad") {
    return "border-zinc-300 border-l-4 border-l-red-500 bg-white text-red-900";
  }
  return "border-zinc-300 border-l-4 border-l-zinc-300 bg-white text-zinc-600";
}

function statusDotClass(status: RouteStatus): string {
  if (status === "ok") {
    return "bg-emerald-500";
  }
  if (status === "warn") {
    return "bg-amber-500";
  }
  if (status === "bad") {
    return "bg-red-500";
  }
  return "bg-zinc-300";
}

function lineClass(status: RouteStatus): string {
  if (status === "ok") {
    return "bg-emerald-500";
  }
  if (status === "warn") {
    return "bg-amber-500";
  }
  if (status === "bad") {
    return "bg-red-500";
  }
  return "bg-zinc-300";
}

function statusWord(status: RouteStatus): string {
  if (status === "ok") {
    return "ok";
  }
  if (status === "warn") {
    return "stale";
  }
  if (status === "bad") {
    return "blocked";
  }
  return "idle";
}

function hasRecentEvent(
  events: TerminalDebugEvent[],
  actions: string[]
): boolean {
  return events.some((event) => actions.includes(event.action));
}

function presentationStatus(
  snapshot: TerminalDebugSnapshot | null
): RouteStatus {
  if (snapshot?.native.error) {
    return "bad";
  }
  const issues = snapshot?.issues ?? [];
  if (issues.some((issue) => issue.severity === "error")) {
    return "bad";
  }
  if (issues.some((issue) => issue.code === "presentation_stale")) {
    return "warn";
  }
  return snapshot ? "ok" : "idle";
}

function focusStatus(snapshot: TerminalDebugSnapshot | null): RouteStatus {
  if (!snapshot) {
    return "idle";
  }
  if (
    snapshot.issues?.some(
      (issue) =>
        issue.code === "input_routing_keyboard_first_responder_mismatch" ||
        issue.code === "input_routing_keyboard_target_mismatch" ||
        issue.code === "input_routing_terminal_surface_focus_mismatch" ||
        issue.code === "input_routing_terminal_target_missing"
    )
  ) {
    return "bad";
  }
  if (snapshot.native.window.keyboardFocusTarget.kind === "terminal") {
    return "ok";
  }
  return "idle";
}

function routeHealth(snapshot: TerminalDebugSnapshot | null): RouteHealth[] {
  const events = snapshot?.events.slice(-48) ?? [];
  const presentation = presentationStatus(snapshot);
  const keyboard: RouteStatus = hasRecentEvent(events, ["key-forward"])
    ? "ok"
    : "idle";
  const mouse: RouteStatus = hasRecentEvent(events, ["right-mouse"])
    ? "ok"
    : "idle";
  const focus = focusStatus(snapshot);
  return [
    { id: "keyboard", label: "Keyboard", status: keyboard },
    { id: "mouse", label: "Mouse", status: mouse },
    { id: "focus", label: "Focus", status: focus },
    { id: "presentation", label: "Presentation", status: presentation },
  ];
}

function NodeCard({
  children,
  icon,
  label,
  status,
}: {
  children: ReactNode;
  icon: ReactNode;
  label: string;
  status: RouteStatus;
}) {
  return (
    <section className="flex min-h-24 flex-col justify-between border border-[#d0d0d0] bg-white p-3">
      <div className="flex items-center gap-2 text-[#6f6f6f]">
        {icon}
        <div className="min-w-0 flex-1 truncate font-semibold text-[#202124] text-sm">
          {label}
        </div>
        <span className={`size-2.5 ${statusDotClass(status)}`} />
      </div>
      <div className="mt-3 truncate font-semibold text-base">{children}</div>
    </section>
  );
}

function Connector({ status }: { status: RouteStatus }) {
  return (
    <div className="hidden items-center md:flex">
      <div className={`h-1 w-full ${lineClass(status)}`} />
    </div>
  );
}

function HealthChip({ item }: { item: RouteHealth }) {
  return (
    <div
      className={`flex min-w-0 items-center justify-between gap-2 border px-3 py-2 text-xs ${statusClass(item.status)}`}
    >
      <span className="truncate font-medium">{item.label}</span>
      <span className="shrink-0 font-semibold">{statusWord(item.status)}</span>
    </div>
  );
}

function RoutingStateView({
  snapshot,
}: {
  snapshot: TerminalDebugSnapshot | null;
}) {
  const presentation = presentationStatus(snapshot);
  const focus = focusStatus(snapshot);
  const surfaceStatus =
    (snapshot?.native.surfaces.length ?? 0) > 0 ? presentation : "idle";
  const keyboardTarget = snapshot?.native.window.keyboardFocusTarget;
  const keyboardTargetText =
    keyboardTarget?.kind === "terminal"
      ? `terminal:${keyboardTarget.panelId}`
      : "web";
  const rendererSeq =
    snapshot?.inputRouting?.desired?.rendererSequence ??
    snapshot?.renderer?.desiredInputRouting?.rendererSequence ??
    "-";
  const nativeSeq =
    snapshot?.native.window.lastAppliedInputRoutingSequence ?? "-";
  const health = routeHealth(snapshot);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-[#d0d0d0] bg-white">
        <div className="flex h-9 shrink-0 items-center border-[#d0d0d0] border-b bg-[#f3f3f3] px-3 font-medium text-sm">
          Routing State
        </div>
        <div className="min-h-0 flex-1 p-4">
          <div className="grid h-full min-h-0 grid-cols-1 items-center gap-3 md:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)_32px_minmax(0,1fr)_32px_minmax(0,1fr)]">
            <NodeCard
              icon={<Columns3 className="size-4" />}
              label="Renderer Coordinator"
              status={presentation}
            >
              {snapshot?.renderer?.desiredInputRouting?.webOverlayRects
                .length ??
                snapshot?.inputRouting?.desired?.webOverlayRects.length ??
                0}{" "}
              web rects
            </NodeCard>
            <Connector status={presentation} />
            <NodeCard
              icon={<Activity className="size-4" />}
              label="Main Validator"
              status={presentation}
            >
              r{rendererSeq} {"->"} r{nativeSeq}
            </NodeCard>
            <Connector status={presentation} />
            <NodeCard
              icon={<Crosshair className="size-4" />}
              label="Native Router"
              status={focus}
            >
              {keyboardTargetText}
            </NodeCard>
            <Connector status={surfaceStatus} />
            <NodeCard
              icon={<MonitorDot className="size-4" />}
              label="Terminal Targets"
              status={surfaceStatus}
            >
              {snapshot?.native.window.terminalTargetCount ?? 0} targets /{" "}
              {snapshot?.native.window.webOverlayRectCount ?? 0} web
            </NodeCard>
          </div>
        </div>
      </section>
      <aside className="shrink-0 border border-[#d0d0d0] bg-white">
        <div className="flex h-9 items-center gap-2 border-[#d0d0d0] border-b bg-[#f3f3f3] px-3">
          <MousePointer2 className="size-4 text-[#6f6f6f]" />
          <div className="font-semibold text-sm">Route Health</div>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-4">
          {health.map((item) => (
            <HealthChip item={item} key={item.id} />
          ))}
        </div>
      </aside>
    </div>
  );
}

export function TerminalDebugWindow({
  targetBrowserWindowId,
}: TerminalDebugWindowProps) {
  const [snapshot, setSnapshot] = useState<TerminalDebugSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<DebugView>("layout");

  const refresh = useMemo(
    () => async () => {
      try {
        const next = await window.pier.terminal.debugSnapshot({
          targetBrowserWindowId,
        });
        setSnapshot(next);
        setError(next.native.error ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [targetBrowserWindowId]
  );

  useEffect(() => {
    refresh().catch(() => undefined);
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 750);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f3f3f3] text-[#202124]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-[#cfcfcf] border-b bg-[#f3f3f3] px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-sm">Terminal Debug</div>
          <div className="text-[#6f6f6f] text-xs">
            Target window {targetBrowserWindowId}
          </div>
        </div>
        <div className="inline-flex border border-[#c8c8c8] bg-[#e9e9e9] p-0.5">
          <button
            className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-xs ${view === "layout" ? "bg-white text-[#202124]" : "text-[#6f6f6f]"}`}
            onClick={() => setView("layout")}
            type="button"
          >
            <Columns3 className="size-3.5" />
            Layout
          </button>
          <button
            className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-xs ${view === "routing" ? "bg-white text-[#202124]" : "text-[#6f6f6f]"}`}
            onClick={() => setView("routing")}
            type="button"
          >
            <GitBranch className="size-3.5" />
            Routing
          </button>
        </div>
        <button
          aria-label="Refresh terminal debug snapshot"
          className="inline-flex size-8 items-center justify-center text-[#6f6f6f] hover:bg-[#e5e5e5] hover:text-[#202124]"
          onClick={() => refresh().catch(() => undefined)}
          type="button"
        >
          <RefreshCw className="size-4" />
        </button>
      </header>
      {error ? (
        <div className="shrink-0 border-red-200 border-b bg-red-50 px-4 py-2 text-red-700 text-xs">
          {error}
        </div>
      ) : null}
      <main className="min-h-0 flex-1 overflow-auto p-2">
        {view === "layout" ? (
          <LayoutStateView snapshot={snapshot} />
        ) : (
          <RoutingStateView snapshot={snapshot} />
        )}
      </main>
    </div>
  );
}
