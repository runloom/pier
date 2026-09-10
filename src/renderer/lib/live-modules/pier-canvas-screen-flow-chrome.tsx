import { workflowEdgeStrokeVar } from "@pier/ui/canvas-workflow/role.ts";
import type { WorkflowEdgeRole } from "@pier/ui/canvas-workflow/types.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import i18next from "i18next";
import type { ReactNode } from "react";

export function screenFlowCopy(
  key: string,
  fallback: string,
  vars: Record<string, string> = {}
): string {
  if (i18next.isInitialized) {
    return i18next.t(key, { defaultValue: fallback, ...vars });
  }
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    fallback
  );
}

function readerMessage(
  diagnostic:
    | {
        code?: string;
        message: string;
      }
    | undefined
): string {
  const code = diagnostic?.code;
  if (code === "screen-flow/tight-row" || code === "screen-flow/tight-column") {
    return screenFlowCopy(
      "canvas.screenFlow.tight",
      "These two screens are too close. Leave a wider gap."
    );
  }
  if (code === "screen-flow/overlap") {
    return screenFlowCopy(
      "canvas.screenFlow.overlap",
      "Two screens overlap. Move one of them."
    );
  }
  if (
    code === "screen-flow/missing-artboard" ||
    code === "screen-flow/missing-frame"
  ) {
    return screenFlowCopy(
      "canvas.screenFlow.missing",
      "A screen on this path is not on the board."
    );
  }
  if (code === "workflow/edge-crosses-node") {
    return screenFlowCopy(
      "canvas.screenFlow.cross",
      "A connector crosses another screen. Move one of them."
    );
  }
  if (code === "screen-flow/label-park") {
    return screenFlowCopy(
      "canvas.screenFlow.labelPark",
      "Two action names overlap. Move one of the screens."
    );
  }
  return diagnostic?.message ?? "";
}

export function ScreenFlowEmptyCard(props: {
  className?: string;
  diagnostics: {
    code?: string;
    message: string;
    supportedFixes: readonly string[];
  }[];
}): ReactNode {
  const first = props.diagnostics[0];
  const body = readerMessage(first);
  const fix = first?.supportedFixes[0];
  return (
    <Empty className={props.className} data-screen-flow="invalid">
      <EmptyHeader>
        <EmptyTitle>
          {screenFlowCopy(
            "canvas.screenFlow.invalidTitle",
            "This screen flow can’t be drawn"
          )}
        </EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
        {fix ? (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground leading-4">
            {fix}
          </p>
        ) : null}
      </EmptyHeader>
    </Empty>
  );
}

const ROLE_COPY: Record<WorkflowEdgeRole, { fallback: string; key: string }> = {
  branch: { fallback: "Branch", key: "canvas.screenFlow.legendBranch" },
  error: { fallback: "Failure", key: "canvas.screenFlow.legendError" },
  main: { fallback: "Main", key: "canvas.screenFlow.legendMain" },
  return: { fallback: "Return", key: "canvas.screenFlow.legendReturn" },
};

export function ScreenFlowLegend(props: {
  left: number;
  roles: readonly WorkflowEdgeRole[];
  top: number;
}): ReactNode {
  if (props.roles.length === 0) {
    return null;
  }
  return (
    <div
      className="pointer-events-none absolute flex items-center gap-3 text-[11px] text-muted-foreground"
      data-slot="screen-flow-legend"
      style={{ left: props.left, top: props.top, zIndex: 2 }}
    >
      <span className="font-medium text-foreground">
        {screenFlowCopy("canvas.screenFlow.legend", "Key")}
      </span>
      {props.roles.map((role) => (
        <span className="inline-flex items-center gap-1.5" key={role}>
          <span
            className="inline-block h-0.5 w-3.5 rounded-full"
            style={{ background: workflowEdgeStrokeVar(role) }}
          />
          {screenFlowCopy(ROLE_COPY[role].key, ROLE_COPY[role].fallback)}
        </span>
      ))}
    </div>
  );
}
