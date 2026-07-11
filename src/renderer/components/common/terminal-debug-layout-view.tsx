import type {
  TerminalFrame,
  TerminalWebOverlayRect,
} from "@shared/contracts/terminal.ts";
import type {
  TerminalDebugIssue,
  TerminalDebugNativeSurfaceSnapshot,
  TerminalDebugRendererPanelSnapshot,
  TerminalDebugSnapshot,
} from "@shared/contracts/terminal-debug.ts";

type LayoutState = "creating" | "hidden" | "missing" | "rendered";

interface Bounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

function isTerminalPanel(panel: TerminalDebugRendererPanelSnapshot): boolean {
  return panel.component === "terminal";
}

function terminalPanels(
  snapshot: TerminalDebugSnapshot | null
): TerminalDebugRendererPanelSnapshot[] {
  return snapshot?.renderer?.panels.filter(isTerminalPanel) ?? [];
}

function nativeByPanelId(snapshot: TerminalDebugSnapshot | null) {
  return new Map(
    (snapshot?.native.surfaces ?? []).map((surface) => [
      surface.panelId,
      surface,
    ])
  );
}

function issuesByPanelId(snapshot: TerminalDebugSnapshot | null) {
  const grouped = new Map<string, TerminalDebugIssue[]>();
  for (const issue of snapshot?.issues ?? []) {
    if (!issue.panelId) {
      continue;
    }
    const current = grouped.get(issue.panelId) ?? [];
    current.push(issue);
    grouped.set(issue.panelId, current);
  }
  return grouped;
}

function visibleSurface(
  surface: TerminalDebugNativeSurfaceSnapshot | undefined
): boolean {
  return Boolean(
    surface && !surface.isHidden && !surface.isOffscreen && surface.alpha > 0
  );
}

function frameDelta(a: TerminalFrame, b: TerminalFrame): number {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height)
  );
}

function panelState(
  panel: TerminalDebugRendererPanelSnapshot,
  surface: TerminalDebugNativeSurfaceSnapshot | undefined,
  issues: TerminalDebugIssue[]
): LayoutState {
  if (issues.some((issue) => issue.severity === "error")) {
    return "missing";
  }
  if (panel.terminalLifecycle?.createPending) {
    return "creating";
  }
  if (!(panel.anchorFrame && panel.dockviewVisible)) {
    return "hidden";
  }
  if (!visibleSurface(surface)) {
    return "missing";
  }
  return "rendered";
}

function stateClass(state: LayoutState): string {
  if (state === "rendered") {
    return "border-status-success-border bg-card text-status-success-fg";
  }
  if (state === "creating") {
    return "border-status-info-border bg-card text-status-info-fg";
  }
  if (state === "missing") {
    return "border-status-danger-border bg-status-danger-bg text-status-danger-fg";
  }
  return "border-border bg-muted text-muted-foreground";
}

function stateDotClass(state: LayoutState): string {
  if (state === "rendered") {
    return "bg-success";
  }
  if (state === "creating") {
    return "bg-info";
  }
  if (state === "missing") {
    return "bg-destructive";
  }
  return "bg-muted-foreground/40";
}

function boundsFor(frames: TerminalFrame[]): Bounds | null {
  if (frames.length === 0) {
    return null;
  }
  const left = Math.min(...frames.map((frame) => frame.x));
  const top = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
  return {
    height: Math.max(1, bottom - top),
    width: Math.max(1, right - left),
    x: left,
    y: top,
  };
}

function snapshotBounds(snapshot: TerminalDebugSnapshot | null): Bounds | null {
  const viewport = snapshot?.renderer?.viewportFrame;
  if (viewport && viewport.width > 1 && viewport.height > 1) {
    return viewport;
  }
  return boundsFor(
    terminalPanels(snapshot).flatMap((panel) =>
      panel.anchorFrame ? [panel.anchorFrame] : []
    )
  );
}

function overlayRects(
  snapshot: TerminalDebugSnapshot | null
): TerminalWebOverlayRect[] {
  const routing = snapshot?.inputRouting;
  return (
    routing?.desired?.webOverlayRects ??
    routing?.effective?.webOverlayRects ??
    []
  );
}

/** Extend the terminal bounds so floating overlays stay in frame when scaled. */
export function mergedLayoutBounds(
  base: Bounds | null,
  overlays: TerminalWebOverlayRect[]
): Bounds | null {
  if (overlays.length === 0) {
    return base;
  }
  const frames: TerminalFrame[] = overlays.map((rect) => rect.frame);
  if (base) {
    frames.push(base);
  }
  return boundsFor(frames);
}

function boxStyle(frame: TerminalFrame, bounds: Bounds) {
  return {
    height: `${Math.max(1, (frame.height / bounds.height) * 100)}%`,
    left: `${((frame.x - bounds.x) / bounds.width) * 100}%`,
    top: `${((frame.y - bounds.y) / bounds.height) * 100}%`,
    width: `${Math.max(1, (frame.width / bounds.width) * 100)}%`,
  };
}

function aligned(
  panel: TerminalDebugRendererPanelSnapshot,
  surface: TerminalDebugNativeSurfaceSnapshot | undefined
): boolean {
  if (!(panel.anchorFrame && surface)) {
    return false;
  }
  const nativeFrame =
    surface.viewportFrame ?? surface.targetRect ?? surface.frame;
  return frameDelta(panel.anchorFrame, nativeFrame) <= 2;
}

function shortId(panelId: string): string {
  if (panelId.length <= 18) {
    return panelId;
  }
  return `${panelId.slice(0, 7)}...${panelId.slice(-6)}`;
}

function LegendChip({ state }: { state: LayoutState }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={`size-2 ${stateDotClass(state)}`} />
      {state}
    </span>
  );
}

function StateLegend() {
  return (
    <div className="flex items-center gap-3">
      <LegendChip state="rendered" />
      <LegendChip state="creating" />
      <LegendChip state="hidden" />
      <LegendChip state="missing" />
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="size-2 border border-status-done-border border-dashed bg-status-done-bg" />
        overlay
      </span>
    </div>
  );
}

function OverlayBox({
  bounds,
  rect,
}: {
  bounds: Bounds;
  rect: TerminalWebOverlayRect;
}) {
  return (
    <div
      className="pointer-events-none absolute z-20 flex flex-col items-start border-2 border-status-done-border border-dashed bg-status-done-bg"
      style={boxStyle(rect.frame, bounds)}
      title="web overlay"
    >
      <span className="m-0.5 inline-flex max-w-full items-center gap-1 bg-done px-1 py-0.5 font-medium text-[10px] text-status-solid-foreground">
        <span className="truncate">{shortId(rect.id)}</span>
        <span className="shrink-0 opacity-80">
          {Math.round(rect.frame.width)}×{Math.round(rect.frame.height)}
        </span>
      </span>
    </div>
  );
}

function AlignmentDots({
  isAligned,
  surface,
}: {
  isAligned: boolean;
  surface: TerminalDebugNativeSurfaceSnapshot | undefined;
}) {
  const domClass = isAligned ? "bg-success" : "bg-warning";
  const nativeClass = visibleSurface(surface) ? "bg-success" : "bg-destructive";
  return (
    <div className="flex items-center gap-1" title="DOM / native">
      <span className={`h-1.5 w-5 ${domClass}`} />
      <span className={`h-1.5 w-5 ${nativeClass}`} />
    </div>
  );
}

function EmptyCanvas() {
  return (
    <div className="flex h-full items-center justify-center bg-background text-muted-foreground text-sm">
      No terminal layout frames
    </div>
  );
}

function TerminalStateStrip({
  groupedIssues,
  panels,
  surfaces,
}: {
  groupedIssues: Map<string, TerminalDebugIssue[]>;
  panels: TerminalDebugRendererPanelSnapshot[];
  surfaces: Map<string, TerminalDebugNativeSurfaceSnapshot>;
}) {
  const entries = panels
    .map((panel) => ({
      panel,
      state: panelState(
        panel,
        surfaces.get(panel.panelId),
        groupedIssues.get(panel.panelId) ?? []
      ),
    }))
    .filter(({ state }) => state !== "rendered");

  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2 border-b bg-card px-3 py-2">
      <div className="shrink-0 font-medium text-muted-foreground text-xs">
        Non-rendered
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {entries.length === 0 ? (
          <span className="text-muted-foreground text-xs">none</span>
        ) : (
          entries.map(({ panel, state }) => (
            <span
              className="inline-flex h-6 min-w-0 items-center gap-1.5 border bg-muted px-2 text-xs"
              key={panel.panelId}
            >
              <span className={`size-2 ${stateDotClass(state)}`} />
              <span className="max-w-40 truncate">
                {shortId(panel.panelId)}
              </span>
              <span className="text-muted-foreground">{state}</span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

export function LayoutStateView({
  snapshot,
}: {
  snapshot: TerminalDebugSnapshot | null;
}) {
  const panels = terminalPanels(snapshot);
  const surfaces = nativeByPanelId(snapshot);
  const groupedIssues = issuesByPanelId(snapshot);
  const overlays = overlayRects(snapshot);
  const bounds = mergedLayoutBounds(snapshotBounds(snapshot), overlays);

  return (
    <section className="flex h-full min-h-[520px] flex-col overflow-hidden border bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between border-b bg-muted px-3">
        <div className="font-medium text-sm">Layout State</div>
        <StateLegend />
      </div>
      <TerminalStateStrip
        groupedIssues={groupedIssues}
        panels={panels}
        surfaces={surfaces}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--debug-grid-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--debug-grid-line)_1px,transparent_1px)] bg-[size:44px_44px]" />
        {bounds ? (
          <>
            {panels.map((panel) => {
              if (!panel.anchorFrame) {
                return null;
              }
              const surface = surfaces.get(panel.panelId);
              const state = panelState(
                panel,
                surface,
                groupedIssues.get(panel.panelId) ?? []
              );
              return (
                <div
                  className={`absolute min-h-12 overflow-hidden border-2 ${stateClass(state)}`}
                  key={panel.panelId}
                  style={boxStyle(panel.anchorFrame, bounds)}
                >
                  <div className="flex h-7 items-center gap-2 border-background/10 border-b bg-foreground px-2 text-background">
                    <span className="min-w-0 flex-1 truncate font-semibold text-xs">
                      {shortId(panel.panelId)}
                    </span>
                    <span className="shrink-0 font-medium text-[10px] text-background uppercase">
                      {state}
                    </span>
                  </div>
                  <div className="flex h-[calc(100%-1.75rem)] min-h-9 items-end justify-between gap-2 p-2">
                    <AlignmentDots
                      isAligned={aligned(panel, surface)}
                      surface={surface}
                    />
                    <div className="flex gap-1">
                      {surface?.hasRouterTarget ? (
                        <span
                          className="size-2 bg-done"
                          title="router target"
                        />
                      ) : null}
                      {surface?.isFirstResponder ? (
                        <span
                          className="size-2 bg-success"
                          title="first responder"
                        />
                      ) : null}
                      {surface?.isSurfaceFocused ? (
                        <span
                          className="size-2 bg-info"
                          title="surface focused"
                        />
                      ) : null}
                      {surface?.hostKeyboardActive ? (
                        <span
                          className="size-2 bg-warning"
                          title="host keyboard active"
                        />
                      ) : null}
                      {surface?.cursorSuppressed ? (
                        <span
                          className="size-2 bg-muted-foreground/40"
                          title="cursor suppressed"
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            {overlays.map((rect) => (
              <OverlayBox bounds={bounds} key={rect.id} rect={rect} />
            ))}
          </>
        ) : (
          <EmptyCanvas />
        )}
      </div>
    </section>
  );
}
