import { Badge } from "pier/canvas";

export type StatusPillTone = "draft" | "ready" | "blocked";

const VARIANT: Record<
  StatusPillTone,
  "neutral" | "success" | "warning" | "danger" | "info"
> = {
  blocked: "danger",
  draft: "warning",
  ready: "success",
};

const LABEL: Record<StatusPillTone, string> = {
  blocked: "Blocked",
  draft: "Draft",
  ready: "Ready",
};

/** Local leaf component — relative import hop 1. */
export function StatusPill({ tone }: { tone: StatusPillTone }) {
  return (
    <Badge size="xs" variant={VARIANT[tone]}>
      {LABEL[tone]}
    </Badge>
  );
}
