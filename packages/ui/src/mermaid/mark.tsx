import {
  AppWindow,
  Bot,
  CircleCheck,
  CircleMinus,
  CircleX,
  ExternalLink,
  type LucideIcon,
  Terminal,
  User,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils.ts";
import {
  KIND_GLYPH,
  KIND_SURFACE,
  type MermaidKind,
  type MermaidNode,
  type MermaidRunStatus,
  TONE_SURFACE,
} from "./model.ts";

const KIND_ICON: Record<MermaidKind, LucideIcon> = {
  actor: User,
  agent: Bot,
  artifact: AppWindow,
  external: ExternalLink,
  tool: Terminal,
};

const RUN_STATUS_GLYPH: Record<
  Exclude<MermaidRunStatus, "queued" | "running">,
  { className: string; Icon: LucideIcon }
> = {
  failed: { className: "text-status-danger-fg!", Icon: CircleX },
  skipped: { className: "text-muted-foreground!", Icon: CircleMinus },
  success: { className: "text-status-success-fg!", Icon: CircleCheck },
};

function RunStatusGlyph({ node }: { node: MermaidNode }) {
  const status = node.status;
  if (!status) {
    return null;
  }
  const label = node.statusLabel ?? status;
  if (status === "running") {
    return (
      <span
        aria-label={label}
        className="size-3 shrink-0 animate-spin rounded-full border-2 border-status-info-fg border-t-transparent"
        data-run-status="running"
        role="status"
      />
    );
  }
  if (status === "queued") {
    return (
      <span
        aria-label={label}
        className="size-3 shrink-0 rounded-full border-2 border-status-info-fg border-dashed"
        data-run-status="queued"
        role="img"
      />
    );
  }
  const { className, Icon } = RUN_STATUS_GLYPH[status];
  return (
    <Icon
      aria-label={label}
      className={cn("size-3 shrink-0", className)}
      data-run-status={status}
      role="img"
    />
  );
}

export function MermaidMark({
  content,
  keyboardSelectable,
  node,
  onSelect,
  selected,
}: {
  content: ReactNode;
  keyboardSelectable: boolean;
  node: MermaidNode;
  onSelect?: ((id: string) => void) | undefined;
  selected: boolean;
}) {
  const toneSurface = node.tone ? TONE_SURFACE[node.tone] : undefined;
  const kindSurface = node.kind ? KIND_SURFACE[node.kind] : undefined;
  const KindIcon = node.kind ? KIND_ICON[node.kind] : undefined;
  const select = () => onSelect?.(node.id);
  const label = `${node.id} ${node.title}`;
  const card = (
    <div
      className={cn(
        "relative box-border flex h-full w-full flex-col justify-center border px-3 py-3 text-left text-card-foreground",
        node.shape === "round" ? "rounded-full" : "rounded-md",
        toneSurface ?? kindSurface ?? "bg-card",
        selected && "border-ring ring-1 ring-ring/40"
      )}
      data-kind={node.kind ?? "none"}
      data-slot="mermaid-node"
      data-tone={node.tone ?? "muted"}
    >
      <div className="flex min-w-0 items-center gap-2">
        {KindIcon ? (
          <KindIcon
            aria-hidden="true"
            className={cn(
              "size-5 shrink-0",
              node.kind ? KIND_GLYPH : undefined
            )}
            data-icon
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="whitespace-normal break-words font-medium text-sm leading-5">
            {node.title}
          </span>
          {node.meta ? (
            <span className="min-w-0 break-words text-muted-foreground text-xs leading-4">
              {node.meta}
            </span>
          ) : null}
        </div>
        <RunStatusGlyph node={node} />
      </div>
      {content !== null && content !== undefined ? (
        <>
          <div className="-mx-3 mt-2 h-px shrink-0 bg-current/10" />
          <div aria-hidden="true" className="h-1.5 shrink-0" />
          <div
            className="flex min-w-0 items-center overflow-hidden border-inherit"
            data-slot="mermaid-node-content"
            style={
              node.contentHeight && node.contentHeight > 0
                ? { height: node.contentHeight }
                : undefined
            }
          >
            {content}
          </div>
        </>
      ) : null}
    </div>
  );
  if (keyboardSelectable) {
    return (
      <button
        aria-label={label}
        className="w-full bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={select}
        type="button"
      >
        {card}
      </button>
    );
  }
  return (
    <div aria-label={label} role="img">
      {card}
    </div>
  );
}
