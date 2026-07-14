/**
 * 物料库预览卡：喂样例形态的纯静态示意（不接真实数据、不可交互）。
 * 宿主在 pointer-events-none 容器里渲染。
 */

function PreviewTile({ bar }: { bar?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-border/50 bg-muted/40 p-1.5">
      <div className="h-1 w-8 rounded-full bg-muted-foreground/25" />
      <div className="h-2 w-5 rounded-sm bg-muted-foreground/40" />
      {bar ? (
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted-foreground/15">
          <div className="h-full w-2/3 rounded-full bg-primary/50" />
        </div>
      ) : null}
    </div>
  );
}

export function ActivityWidgetPreview() {
  return (
    <div className="flex h-full flex-col gap-1.5 p-2.5">
      <div className="grid grid-cols-3 gap-1.5">
        <PreviewTile />
        <PreviewTile />
        <PreviewTile />
      </div>
      <div className="flex items-center gap-1.5 px-0.5">
        <div className="size-1.5 rounded-full bg-success/70" />
        <div className="h-1.5 flex-1 rounded-full bg-muted-foreground/20" />
      </div>
      <div className="flex items-center gap-1.5 px-0.5">
        <div className="size-1.5 rounded-full bg-warning/70" />
        <div className="h-1.5 flex-1 rounded-full bg-muted-foreground/20" />
      </div>
    </div>
  );
}

export function SystemResourcesWidgetPreview() {
  return (
    <div className="flex h-full flex-col gap-1.5 p-2.5">
      <div className="grid grid-cols-2 gap-1.5">
        <PreviewTile bar />
        <PreviewTile bar />
      </div>
      <svg
        aria-hidden="true"
        className="min-h-0 w-full flex-1 text-primary/50"
        preserveAspectRatio="none"
        viewBox="0 0 100 24"
      >
        <path
          d="M0 20 L14 16 L28 18 L42 9 L56 13 L70 5 L84 11 L100 7 L100 24 L0 24 Z"
          fill="currentColor"
          opacity="0.25"
        />
        <path
          d="M0 20 L14 16 L28 18 L42 9 L56 13 L70 5 L84 11 L100 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}

// 5 根堆叠柱的静态示意：[x, 底层 y+高度, 顶层 y+高度]。
const COST_PREVIEW_BARS: readonly [number, number, number, number, number][] = [
  [4, 14, 10, 8, 6],
  [22, 10, 14, 6, 4],
  [40, 16, 8, 8, 8],
  [58, 8, 16, 4, 4],
  [76, 12, 12, 6, 6],
];

export function CostOverviewWidgetPreview() {
  return (
    <div className="flex h-full flex-col gap-1.5 p-2.5">
      <div className="grid grid-cols-2 gap-1.5">
        <PreviewTile />
        <PreviewTile />
      </div>
      <svg
        aria-hidden="true"
        className="min-h-0 w-full flex-1 text-primary/60"
        preserveAspectRatio="none"
        viewBox="0 0 100 24"
      >
        {COST_PREVIEW_BARS.map(([x, bottomY, bottomH, topY, topH]) => (
          <g key={x}>
            <rect
              fill="currentColor"
              height={bottomH}
              opacity="0.35"
              width="10"
              x={x}
              y={bottomY}
            />
            <rect
              fill="currentColor"
              height={topH}
              opacity="0.65"
              width="10"
              x={x}
              y={topY}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

export function CustomCardWidgetPreview() {
  return (
    <div className="flex h-full flex-col gap-1.5 p-2.5">
      <PreviewTile />
      <div className="flex flex-col gap-1 rounded-sm border border-border/50 bg-muted/40 p-1.5">
        <div className="h-1 w-10 rounded-full bg-muted-foreground/25" />
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted-foreground/15">
          <div className="h-full w-4/5 rounded-full bg-primary/50" />
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted-foreground/15">
          <div className="h-full w-1/2 rounded-full bg-primary/50" />
        </div>
      </div>
    </div>
  );
}
