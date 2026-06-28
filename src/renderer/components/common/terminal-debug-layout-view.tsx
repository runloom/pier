import type {
  TerminalDebugIssue,
  TerminalDebugNativeSurfaceSnapshot,
  TerminalDebugRendererPanelSnapshot,
  TerminalDebugSnapshot,
  TerminalFrame,
} from "@shared/contracts/terminal.ts";

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
    return "border-emerald-500 bg-white text-emerald-950";
  }
  if (state === "creating") {
    return "border-sky-500 bg-white text-sky-950";
  }
  if (state === "missing") {
    return "border-red-500 bg-red-50/40 text-red-950";
  }
  return "border-zinc-400 bg-zinc-50 text-zinc-600";
}

function stateChipClass(state: LayoutState): string {
  if (state === "rendered") {
    return "text-emerald-300";
  }
  if (state === "creating") {
    return "text-sky-300";
  }
  if (state === "missing") {
    return "text-red-300";
  }
  return "text-zinc-300";
}

function stateDotClass(state: LayoutState): string {
  if (state === "rendered") {
    return "bg-emerald-500";
  }
  if (state === "creating") {
    return "bg-sky-500";
  }
  if (state === "missing") {
    return "bg-red-500";
  }
  return "bg-zinc-400";
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
    <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600">
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
  const domClass = isAligned ? "bg-emerald-500" : "bg-amber-500";
  const nativeClass = visibleSurface(surface) ? "bg-emerald-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-1" title="DOM / native">
      <span className={`h-1.5 w-5 ${domClass}`} />
      <span className={`h-1.5 w-5 ${nativeClass}`} />
    </div>
  );
}

function EmptyCanvas() {
  return (
    <div className="flex h-full items-center justify-center bg-white text-muted-foreground text-sm">
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
    <div className="flex min-h-10 shrink-0 items-center gap-2 border-[#d0d0d0] border-b bg-white px-3 py-2">
      <div className="shrink-0 font-medium text-[#6f6f6f] text-xs">
        Non-rendered
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {entries.length === 0 ? (
          <span className="text-[#6f6f6f] text-xs">none</span>
        ) : (
          entries.map(({ panel, state }) => (
            <span
              className="inline-flex h-6 min-w-0 items-center gap-1.5 border border-zinc-300 bg-[#f7f7f7] px-2 text-xs"
              key={panel.panelId}
            >
              <span className={`size-2 ${stateDotClass(state)}`} />
              <span className="max-w-40 truncate">
                {shortId(panel.panelId)}
              </span>
              <span className="text-[#6f6f6f]">{state}</span>
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
  const bounds = snapshotBounds(snapshot);

  return (
    <section className="flex h-full min-h-[520px] flex-col overflow-hidden border border-[#d0d0d0] bg-white">
      <div className="flex h-9 shrink-0 items-center justify-between border-[#d0d0d0] border-b bg-[#f3f3f3] px-3">
        <div className="font-medium text-sm">Layout State</div>
        <StateLegend />
      </div>
      <TerminalStateStrip
        groupedIssues={groupedIssues}
        panels={panels}
        surfaces={surfaces}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(24,24,27,0.055)_1px,transparent_1px),linear-gradient(to_bottom,rgba(24,24,27,0.055)_1px,transparent_1px)] bg-[size:44px_44px]" />
        {bounds ? (
          panels.map((panel) => {
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
                <div className="flex h-7 items-center gap-2 border-black/10 border-b bg-zinc-900 px-2 text-white">
                  <span className="min-w-0 flex-1 truncate font-semibold text-xs">
                    {shortId(panel.panelId)}
                  </span>
                  <span
                    className={`shrink-0 font-medium text-[10px] uppercase ${stateChipClass(state)}`}
                  >
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
                        className="size-2 bg-violet-500"
                        title="router target"
                      />
                    ) : null}
                    {surface?.isFirstResponder ? (
                      <span
                        className="size-2 bg-emerald-500"
                        title="first responder"
                      />
                    ) : null}
                    {surface?.isSurfaceFocused ? (
                      <span
                        className="size-2 bg-sky-500"
                        title="surface focused"
                      />
                    ) : null}
                    {surface?.hostKeyboardActive ? (
                      <span
                        className="size-2 bg-cyan-500"
                        title="host keyboard active"
                      />
                    ) : null}
                    {surface?.cursorSuppressed ? (
                      <span
                        className="size-2 bg-zinc-400"
                        title="cursor suppressed"
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <EmptyCanvas />
        )}
      </div>
    </section>
  );
}
