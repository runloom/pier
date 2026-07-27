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
        <div className="size-3.5 shrink-0 rounded-sm bg-warning/40" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="h-1.5 w-3/4 rounded-full bg-muted-foreground/30" />
          <div className="h-1 w-1/3 rounded-full bg-warning/50" />
        </div>
        <div className="h-1 w-6 shrink-0 rounded-full bg-muted-foreground/20" />
      </div>
      <div className="flex items-center gap-1.5 px-0.5">
        <div className="size-3.5 shrink-0 rounded-sm bg-success/40" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="h-1.5 w-2/3 rounded-full bg-muted-foreground/25" />
          <div className="h-1 w-1/4 rounded-full bg-success/50" />
        </div>
        <div className="h-1 w-5 shrink-0 rounded-full bg-muted-foreground/15" />
      </div>
    </div>
  );
}

export function SystemResourcesWidgetPreview() {
  return (
    <div className="flex h-full flex-col gap-1.5 p-2.5">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="h-1 w-8 rounded-full bg-muted-foreground/25" />
          <div className="h-2.5 w-10 rounded-sm bg-muted-foreground/45" />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="h-1 w-6 rounded-full bg-muted-foreground/25" />
          <div className="h-2.5 w-8 rounded-sm bg-muted-foreground/40" />
        </div>
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
      <div className="flex flex-col gap-1 px-0.5">
        <div className="flex items-center justify-between gap-2">
          <div className="h-1.5 w-14 rounded-full bg-muted-foreground/25" />
          <div className="h-1.5 w-8 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="h-1.5 w-10 rounded-full bg-muted-foreground/20" />
          <div className="h-1.5 w-6 rounded-full bg-muted-foreground/15" />
        </div>
      </div>
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
    <div className="flex h-full flex-col gap-2 p-2.5">
      <div className="rounded-sm border border-border/50 bg-muted/30 px-2 py-1.5">
        <div className="mb-0.5 h-1 w-8 rounded-full bg-muted-foreground/30" />
        <div className="h-3.5 w-12 rounded-sm bg-foreground/60" />
      </div>
      <div className="flex items-center gap-1.5 rounded-sm border border-border/50 bg-muted/30 px-2 py-1.5">
        <svg
          aria-hidden="true"
          className="shrink-0 -rotate-90 text-primary/70"
          height="20"
          viewBox="0 0 20 20"
          width="20"
        >
          <circle
            className="fill-none stroke-muted/40"
            cx="10"
            cy="10"
            r="7"
            strokeWidth="2.5"
          />
          <circle
            className="fill-none stroke-current"
            cx="10"
            cy="10"
            r="7"
            strokeDasharray="44"
            strokeDashoffset="13"
            strokeLinecap="round"
            strokeWidth="2.5"
          />
        </svg>
        <div className="h-2.5 w-8 rounded-sm bg-foreground/50" />
      </div>
      <svg
        aria-hidden="true"
        className="h-8 w-full text-primary/60"
        preserveAspectRatio="none"
        viewBox="0 0 80 24"
      >
        <defs>
          <linearGradient
            id="custom-card-preview-trend"
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop
              className="text-primary"
              offset="0%"
              stopColor="currentColor"
              stopOpacity={0.25}
            />
            <stop
              className="text-primary"
              offset="100%"
              stopColor="currentColor"
              stopOpacity={0.02}
            />
          </linearGradient>
        </defs>
        <path
          d="M0 18 L16 14 L32 16 L48 8 L64 10 L80 4 L80 24 L0 24 Z"
          fill="url(#custom-card-preview-trend)"
        />
        <path
          className="stroke-current"
          d="M0 18 L16 14 L32 16 L48 8 L64 10 L80 4"
          fill="none"
          strokeWidth="1.5"
        />
        <circle className="fill-current" cx="80" cy="4" r="1.8" />
      </svg>
      <div className="flex flex-col gap-1 rounded-sm border border-border/50 bg-muted/30 px-2 py-1.5">
        {[0.85, 0.55, 0.3].map((w, i) => (
          <div className="flex flex-col gap-0.5" key={String(i)}>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted-foreground/15">
              <div
                className="h-full rounded-full bg-primary/55"
                style={{ width: `${w * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
