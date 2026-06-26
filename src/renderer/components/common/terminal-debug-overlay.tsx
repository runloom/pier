import type {
  TerminalDebugEvent,
  TerminalDebugIssue,
  TerminalDebugNativeSurfaceSnapshot,
  TerminalDebugRendererPanelSnapshot,
  TerminalFrame,
} from "@shared/contracts/terminal.ts";
import { Bug, RefreshCw, X } from "lucide-react";
import { useEffect } from "react";
import { useTerminalDebugStore } from "@/stores/terminal-debug.store.ts";
import { popOverlay, pushOverlay } from "@/stores/terminal-overlay.store.ts";

function formatFrame(frame: TerminalFrame | null | undefined): string {
  if (!frame) {
    return "-";
  }
  return `${Math.round(frame.x)},${Math.round(frame.y)} ${Math.round(frame.width)}x${Math.round(frame.height)}`;
}

function renderedLabel(surface: TerminalDebugNativeSurfaceSnapshot): string {
  if (surface.isHidden) {
    return "hidden";
  }
  if (surface.isOffscreen) {
    return "offscreen";
  }
  if (surface.alpha <= 0) {
    return "transparent";
  }
  return "rendered";
}

function issueTone(issue: TerminalDebugIssue): string {
  return issue.severity === "error"
    ? "border-destructive/35 bg-destructive/10 text-destructive"
    : "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function panelIssueLabel(issues: TerminalDebugIssue[]): string {
  if (issues.length === 0) {
    return "ok";
  }
  return issues.map((issue) => issue.code).join(", ");
}

function panelStatusTone(issues: TerminalDebugIssue[]): string {
  if (issues.some((issue) => issue.severity === "error")) {
    return "bg-destructive/10 text-destructive";
  }
  if (issues.length > 0) {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function panelFlags(panel: TerminalDebugRendererPanelSnapshot): string {
  const flags = [
    panel.isActivePanel ? "active" : null,
    panel.dockviewVisible ? "visible" : "hidden",
    panel.dockviewActive ? "api-active" : null,
    panel.hasAnchor ? "anchor" : "no-anchor",
  ].filter(Boolean);
  return flags.join(" / ");
}

function routeTone(route: TerminalDebugEvent["route"]): string {
  if (route === "native->main->renderer") {
    return "text-sky-700 dark:text-sky-300";
  }
  if (route === "renderer->main->webContents") {
    return "text-amber-700 dark:text-amber-300";
  }
  return "text-emerald-700 dark:text-emerald-300";
}

export function TerminalDebugOverlay() {
  const close = useTerminalDebugStore((state) => state.close);
  const error = useTerminalDebugStore((state) => state.error);
  const isOpen = useTerminalDebugStore((state) => state.isOpen);
  const refresh = useTerminalDebugStore((state) => state.refresh);
  const snapshot = useTerminalDebugStore((state) => state.snapshot);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    pushOverlay();
    return () => {
      popOverlay();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    refresh().catch(() => undefined);
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 750);
    return () => window.clearInterval(timer);
  }, [isOpen, refresh]);

  if (!isOpen) {
    return null;
  }

  const surfaces = snapshot?.native.surfaces ?? [];
  const rendererPanels =
    snapshot?.renderer?.panels.filter(
      (panel) => panel.component === "terminal"
    ) ?? [];
  const events = snapshot?.events.slice(-12).reverse() ?? [];
  const issues = snapshot?.issues ?? [];
  const nativeByPanelId = new Map(
    surfaces.map((surface) => [surface.panelId, surface])
  );
  const issuesByPanelId = new Map<string, TerminalDebugIssue[]>();
  for (const issue of issues) {
    if (!issue.panelId) {
      continue;
    }
    const panelIssues = issuesByPanelId.get(issue.panelId) ?? [];
    panelIssues.push(issue);
    issuesByPanelId.set(issue.panelId, panelIssues);
  }
  const rendererPanelIds = new Set(
    rendererPanels.map((panel) => panel.panelId)
  );
  const orphanSurfaces = surfaces.filter(
    (surface) => !rendererPanelIds.has(surface.panelId)
  );

  return (
    <div
      className="fixed right-3 bottom-3 z-50 flex max-h-[78vh] w-[min(980px,calc(100vw-24px))] flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-2xl"
      data-testid="terminal-debug-overlay"
    >
      <div className="flex h-10 items-center gap-2 border-border border-b px-3">
        <Bug className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate font-medium text-sm">
          Native Terminal Debug
        </div>
        <button
          aria-label="Refresh terminal debug snapshot"
          className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={() => refresh().catch(() => undefined)}
          type="button"
        >
          <RefreshCw className="size-4" />
        </button>
        <button
          aria-label="Close terminal debug overlay"
          className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          onClick={close}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="grid min-h-0 grid-cols-1 gap-0 overflow-auto text-xs lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <section className="border-border border-b p-3 lg:border-r lg:border-b-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-medium text-foreground text-xs uppercase tracking-normal">
              Panel Matrix
            </h2>
            <span className="text-muted-foreground">
              {rendererPanels.length} panels / {surfaces.length} surfaces
            </span>
          </div>
          {error ? (
            <div className="rounded-sm border border-destructive/30 bg-destructive/10 p-2 text-destructive">
              {error}
            </div>
          ) : null}
          {snapshot?.native.error ? (
            <div className="rounded-sm border border-destructive/30 bg-destructive/10 p-2 text-destructive">
              {snapshot.native.error}
            </div>
          ) : null}
          {issues.length > 0 ? (
            <div className="mb-3 space-y-1.5">
              {issues.slice(0, 6).map((issue) => (
                <div
                  className={`rounded-sm border p-2 ${issueTone(issue)}`}
                  key={`${issue.code}-${issue.panelId ?? "window"}-${issue.severity}-${issue.message}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{issue.code}</span>
                    <span>{issue.panelId ?? "window"}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {issue.message}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mb-3 rounded-sm border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-300">
              No renderer/native mismatches detected
            </div>
          )}
          <div className="space-y-2">
            {rendererPanels.map((panel) => {
              const nativeSurface = nativeByPanelId.get(panel.panelId);
              const panelIssues = issuesByPanelId.get(panel.panelId) ?? [];
              return (
                <div
                  className="rounded-sm border border-border bg-background/70 p-2"
                  key={panel.panelId}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate font-medium">
                      {panel.panelId}
                    </span>
                    <span
                      className={`rounded-sm px-1.5 py-0.5 ${panelStatusTone(panelIssues)}`}
                    >
                      {panelIssueLabel(panelIssues)}
                    </span>
                  </div>
                  <dl className="grid grid-cols-[92px_1fr] gap-x-2 gap-y-1 text-muted-foreground">
                    <dt>dockview</dt>
                    <dd className="truncate">{panelFlags(panel)}</dd>
                    <dt>dom</dt>
                    <dd>{formatFrame(panel.anchorFrame)}</dd>
                    <dt>native</dt>
                    <dd>
                      {nativeSurface ? renderedLabel(nativeSurface) : "missing"}
                    </dd>
                    <dt>native viewport</dt>
                    <dd>
                      {formatFrame(
                        nativeSurface?.viewportFrame ??
                          nativeSurface?.targetRect
                      )}
                    </dd>
                    <dt>appkit frame</dt>
                    <dd>{formatFrame(nativeSurface?.frame)}</dd>
                    <dt>target</dt>
                    <dd>{formatFrame(nativeSurface?.targetRect)}</dd>
                  </dl>
                </div>
              );
            })}
            {orphanSurfaces.map((surface) => (
              <div
                className="rounded-sm border border-amber-500/35 bg-amber-500/10 p-2"
                key={`orphan-${surface.nativePanelId}`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    {surface.panelId}
                  </span>
                  <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                    orphan native
                  </span>
                </div>
                <dl className="grid grid-cols-[82px_1fr] gap-x-2 gap-y-1 text-muted-foreground">
                  <dt>native</dt>
                  <dd className="truncate">{surface.nativePanelId}</dd>
                  <dt>viewport</dt>
                  <dd>
                    {formatFrame(surface.viewportFrame ?? surface.targetRect)}
                  </dd>
                  <dt>appkit</dt>
                  <dd>{formatFrame(surface.frame)}</dd>
                  <dt>target</dt>
                  <dd>{formatFrame(surface.targetRect)}</dd>
                  <dt>router</dt>
                  <dd>{surface.hasRouterTarget ? "targeted" : "missing"}</dd>
                  <dt>focus</dt>
                  <dd>{surface.isFirstResponder ? "firstResponder" : "-"}</dd>
                </dl>
              </div>
            ))}
            {rendererPanels.length === 0 && orphanSurfaces.length === 0 ? (
              <div className="rounded-sm border border-border bg-background/70 p-2 text-muted-foreground">
                No terminal panels or native surfaces
              </div>
            ) : null}
          </div>
        </section>
        <section className="p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-medium text-foreground text-xs uppercase tracking-normal">
              Routing
            </h2>
            <span className="text-muted-foreground">
              {snapshot?.native.window.activePanelKind ?? "web"}
            </span>
          </div>
          <dl className="mb-3 grid grid-cols-[104px_1fr] gap-x-2 gap-y-1 text-muted-foreground">
            <dt>active</dt>
            <dd>{snapshot?.native.window.activeTerminalPanelId ?? "-"}</dd>
            <dt>native active</dt>
            <dd className="truncate">
              {snapshot?.native.window.nativeActiveTerminalPanelId ?? "-"}
            </dd>
            <dt>mode</dt>
            <dd>
              {snapshot?.native.window.inTerminalMode
                ? "terminal"
                : "web/overlay"}
            </dd>
            <dt>overlay</dt>
            <dd>{snapshot?.native.window.overlayActive ? "active" : "-"}</dd>
          </dl>
          <div className="space-y-1.5">
            {events.map((event) => (
              <div
                className="rounded-sm border border-border bg-background/70 p-2"
                key={event.id}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{event.action}</span>
                  <span className="text-muted-foreground">
                    {new Date(event.at).toLocaleTimeString()}
                  </span>
                </div>
                <div className={routeTone(event.route)}>{event.route}</div>
                <div className="mt-1 truncate text-muted-foreground">
                  {event.panelId ?? event.nativePanelId ?? "-"}
                  {event.detail ? ` ${JSON.stringify(event.detail)}` : ""}
                </div>
              </div>
            ))}
            {events.length === 0 ? (
              <div className="rounded-sm border border-border bg-background/70 p-2 text-muted-foreground">
                No routed events yet
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
