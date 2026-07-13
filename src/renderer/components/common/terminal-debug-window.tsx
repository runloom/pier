import { Button } from "@pier/ui/button.tsx";
import { ToggleGroup, ToggleGroupItem } from "@pier/ui/toggle-group.tsx";
import { cn } from "@pier/ui/utils.ts";
import type {
  TerminalDebugEvent,
  TerminalDebugRouterDecision,
  TerminalDebugRouterDecisionPayload,
  TerminalDebugSnapshot,
} from "@shared/contracts/terminal-debug.ts";
import {
  Activity,
  Columns3,
  Crosshair,
  GitBranch,
  ListTree,
  MonitorDot,
  MousePointer2,
  RefreshCw,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutStateView } from "./terminal-debug-layout-view.tsx";
import {
  type TerminalDebugRouteStatus,
  terminalDebugStatusClass,
  terminalDebugStatusFill,
  terminalDebugStatusWord,
} from "./terminal-debug-status-visual.ts";

type DebugView = "layout" | "routing";

interface TerminalDebugWindowProps {
  targetBrowserWindowId: number;
}

interface RouteHealth {
  id: string;
  label: string;
  status: TerminalDebugRouteStatus;
}

function hasRecentEvent(
  events: TerminalDebugEvent[],
  actions: string[]
): boolean {
  return events.some((event) => actions.includes(event.action));
}

function presentationStatus(
  snapshot: TerminalDebugSnapshot | null
): TerminalDebugRouteStatus {
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

function focusStatus(
  snapshot: TerminalDebugSnapshot | null
): TerminalDebugRouteStatus {
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
  const keyboard: TerminalDebugRouteStatus = hasRecentEvent(events, [
    "key-forward",
  ])
    ? "ok"
    : "idle";
  const mouse: TerminalDebugRouteStatus = hasRecentEvent(events, [
    "right-mouse",
  ])
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
  status: TerminalDebugRouteStatus;
}) {
  return (
    <section className="flex min-h-24 flex-col justify-between border bg-card p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <div className="min-w-0 flex-1 truncate font-semibold text-foreground text-sm">
          {label}
        </div>
        <span className={cn("size-2.5", terminalDebugStatusFill(status))} />
      </div>
      <div className="mt-3 truncate font-semibold text-base">{children}</div>
    </section>
  );
}

function Connector({ status }: { status: TerminalDebugRouteStatus }) {
  return (
    <div className="hidden items-center md:flex">
      <div className={cn("h-1 w-full", terminalDebugStatusFill(status))} />
    </div>
  );
}

function HealthChip({ item }: { item: RouteHealth }) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-2 border px-3 py-2 text-xs",
        terminalDebugStatusClass(item.status)
      )}
    >
      <span className="truncate font-medium">{item.label}</span>
      <span className="shrink-0 font-semibold">
        {terminalDebugStatusWord(item.status)}
      </span>
    </div>
  );
}

function formatDecisionAge(at: number, nowSeconds: number): string {
  // at=0 是 normalize 对缺失/非法字段的 fallback: 直接算差会得到 55 年级别的
  // "N千万分钟前" 胡言, 视为未知即可; 超过一天视同 stale 也用 dash.
  if (!Number.isFinite(at) || at <= 0) {
    return "—";
  }
  const deltaSeconds = Math.max(0, nowSeconds - at);
  if (deltaSeconds < 1) {
    return `${Math.round(deltaSeconds * 1000)}ms ago`;
  }
  if (deltaSeconds < 60) {
    return `${deltaSeconds.toFixed(1)}s ago`;
  }
  if (deltaSeconds < 3600) {
    return `${Math.floor(deltaSeconds / 60)}m ago`;
  }
  if (deltaSeconds < 86_400) {
    return `${Math.floor(deltaSeconds / 3600)}h ago`;
  }
  return "—";
}

function formatDecisionPayload(
  payload: TerminalDebugRouterDecisionPayload
): string {
  return Object.entries(payload)
    .map(([key, raw]) => {
      if (raw === null) {
        return `${key}=null`;
      }
      if (typeof raw === "number") {
        // 坐标数值裁到 1 位小数, 长 float 字符串会挤爆行.
        return `${key}=${Number.isInteger(raw) ? raw : raw.toFixed(1)}`;
      }
      // 字符串值走 JSON.stringify 加引号 + 转义: 未来若 payload 里出现空格/tab/
      // 私区 unicode 的字符串, 空格 join 会把 `chars=" "` 变成两个模糊 token; 引号
      // 让每个 pair 边界依旧可读。
      return `${key}=${JSON.stringify(raw)}`;
    })
    .join(" ");
}

/**
 * 决策是否指向 "看得见但点不到 / 按键不到 terminal" 的可疑路径, 用琥珀色高亮:
 * - hit-test/right-mouse miss 或 web-overlay: 只有当此窗口存在 terminal target 时
 *   才算可疑; 纯 web 页面点击也会命中 web-overlay, 那时应视为常态。
 * - key-down web-passthrough: 仅当 activeTerminalPanelId != null (即 basePanel
 *   已指向 terminal 但 key 却被路由到 web) 才算可疑; 否则是普通 web 输入。
 * - key-down menu-consumed: 仅当 acceptsTerminalKeyboard === true (terminal 期待
 *   接收 key 却被系统菜单吃掉) 才算可疑 —— 正好是 "按 Cmd+K 期望到 terminal 但
 *   被 macOS menu 拦截" 的经典场景。
 */
function isSuspiciousDecision(decision: TerminalDebugRouterDecision): boolean {
  const rawDecision = decision.payload.decision;
  if (typeof rawDecision !== "string") {
    return false;
  }
  if (decision.kind === "hit-test") {
    if (rawDecision !== "miss" && rawDecision !== "web-overlay") {
      return false;
    }
    const targetsCount = decision.payload.targetsCount;
    return typeof targetsCount === "number" ? targetsCount > 0 : true;
  }
  if (decision.kind === "right-mouse") {
    return rawDecision === "miss" || rawDecision === "web-overlay";
  }
  if (decision.kind === "key-down") {
    if (rawDecision === "web-passthrough") {
      return decision.payload.activeTerminalPanelId !== null;
    }
    if (rawDecision === "menu-consumed") {
      return decision.payload.acceptsTerminalKeyboard === true;
    }
  }
  return false;
}

function RouterDecisionsPanel({
  decisions,
  droppedCount,
}: {
  decisions: TerminalDebugRouterDecision[];
  droppedCount: number;
}) {
  // debug window 每 750ms 拉一次 snapshot 触发 re-render, nowSeconds 顺带刷新;
  // age 显示误差不超过一次 refresh interval, 对复盘足够。
  const nowSeconds = Date.now() / 1000;
  const orderedRecent = useMemo(() => decisions.slice().reverse(), [decisions]);
  return (
    <section className="flex min-h-0 shrink-0 flex-col border bg-card">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted px-3">
        <ListTree className="size-4 text-muted-foreground" />
        <div className="font-semibold text-sm">Recent Router Decisions</div>
        <div className="ml-auto text-muted-foreground text-xs">
          {decisions.length} / 64
          {droppedCount > 0 ? (
            <span className="ml-2 text-status-warning-fg">
              ({droppedCount} dropped)
            </span>
          ) : null}
        </div>
      </div>
      <div className="max-h-64 min-h-0 overflow-auto">
        {orderedRecent.length === 0 ? (
          <div className="p-3 text-muted-foreground text-xs">
            No decisions yet — reproduce the issue (click, press a key, right
            click) to populate.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {orderedRecent.map((decision) => {
              const suspicious = isSuspiciousDecision(decision);
              return (
                <li
                  className={cn(
                    "flex flex-wrap gap-2 px-3 py-1.5 font-mono text-xs",
                    suspicious && "bg-status-warning-bg text-status-warning-fg"
                  )}
                  key={decision.seq}
                >
                  <span className="shrink-0 text-muted-foreground">
                    {formatDecisionAge(decision.at, nowSeconds)}
                  </span>
                  <span className="shrink-0 font-semibold">
                    {decision.kind}
                  </span>
                  <span className="min-w-0 flex-1 break-all">
                    {formatDecisionPayload(decision.payload)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
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
    snapshot?.coordinator?.desired?.rendererSequence ??
    snapshot?.renderer?.desiredHostSnapshot?.rendererSequence ??
    "-";
  const nativeSeq = snapshot?.native.window.lastAppliedRendererSequence ?? "-";
  const health = routeHealth(snapshot);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden border bg-card">
        <div className="flex h-9 shrink-0 items-center border-b bg-muted px-3 font-medium text-sm">
          Routing State
        </div>
        <div className="min-h-0 flex-1 p-4">
          <div className="grid h-full min-h-0 grid-cols-1 items-center gap-3 md:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)_32px_minmax(0,1fr)_32px_minmax(0,1fr)]">
            <NodeCard
              icon={<Columns3 className="size-4" />}
              label="Renderer Coordinator"
              status={presentation}
            >
              {snapshot?.coordinator?.desired?.webOverlayRects.length ??
                snapshot?.renderer?.desiredHostSnapshot?.webOverlayRects
                  .length ??
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
      <aside className="shrink-0 border bg-card">
        <div className="flex h-9 items-center gap-2 border-b bg-muted px-3">
          <MousePointer2 className="size-4 text-muted-foreground" />
          <div className="font-semibold text-sm">Route Health</div>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-4">
          {health.map((item) => (
            <HealthChip item={item} key={item.id} />
          ))}
        </div>
      </aside>
      <RouterDecisionsPanel
        decisions={snapshot?.native.window.recentRouterDecisions ?? []}
        droppedCount={snapshot?.native.window.routerDecisionsDroppedCount ?? 0}
      />
    </div>
  );
}

export function TerminalDebugWindow({
  targetBrowserWindowId,
}: TerminalDebugWindowProps) {
  const [snapshot, setSnapshot] = useState<TerminalDebugSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<DebugView>("layout");

  const refresh = useCallback(async () => {
    try {
      const next = await window.pier.terminal.debugSnapshot({
        targetBrowserWindowId,
      });
      setSnapshot(next);
      setError(next.native.error ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [targetBrowserWindowId]);

  useEffect(() => {
    refresh().catch(() => undefined);
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 750);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-muted text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-muted px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-sm">Terminal Debug</div>
          <div className="text-muted-foreground text-xs">
            Target window {targetBrowserWindowId}
          </div>
        </div>
        <ToggleGroup
          aria-label="Terminal debug view"
          onValueChange={(next) => {
            if (next === "layout" || next === "routing") {
              setView(next);
            }
          }}
          size="sm"
          spacing={0}
          type="single"
          value={view}
          variant="outline"
        >
          <ToggleGroupItem value="layout">
            <Columns3 data-icon="inline-start" />
            Layout
          </ToggleGroupItem>
          <ToggleGroupItem value="routing">
            <GitBranch data-icon="inline-start" />
            Routing
          </ToggleGroupItem>
        </ToggleGroup>
        <Button
          aria-label="Refresh terminal debug snapshot"
          onClick={() => refresh().catch(() => undefined)}
          size="icon"
          tone="muted"
          type="button"
          variant="ghost"
        >
          <RefreshCw data-icon="inline-start" />
        </Button>
      </header>
      {error ? (
        <div className="shrink-0 border-status-danger-border border-b bg-status-danger-bg px-4 py-2 text-status-danger-fg text-xs">
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
