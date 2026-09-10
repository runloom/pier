import { compileWorkflowLayout } from "@pier/ui/canvas-workflow/compile.ts";
import { WorkflowPaint } from "@pier/ui/canvas-workflow/paint.tsx";
import type { WorkflowSpec } from "@pier/ui/canvas-workflow/types.ts";
import { validateWorkflowSpec } from "@pier/ui/canvas-workflow/validate.ts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import i18next from "i18next";
import { useWorldStageScope, WorldStage } from "./pier-canvas-artboard.tsx";

export type {
  WorkflowSpec,
  WorkflowValidateReceipt,
} from "@pier/ui/canvas-workflow/types.ts";
export { validateWorkflowSpec } from "@pier/ui/canvas-workflow/validate.ts";

function copy(
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

export function WorkflowDiagram({
  className,
  spec,
}: {
  className?: string;
  spec: WorkflowSpec;
}) {
  const nested = useWorldStageScope();
  const receipt = validateWorkflowSpec(spec);
  if (receipt.status !== 0) {
    const first = receipt.diagnostics[0];
    return (
      <Empty className={className} data-workflow="invalid">
        <EmptyHeader>
          <EmptyTitle>
            {copy(
              "canvas.workflow.invalidTitle",
              "This flowchart can’t be drawn"
            )}
          </EmptyTitle>
          <EmptyDescription>
            {copy("canvas.workflow.invalidHint", "{{message}} Next: {{fix}}", {
              fix: first?.supportedFixes[0] ?? "",
              message: first?.message ?? "",
            })}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const layout = compileWorkflowLayout(spec);
  const paint = (
    <WorkflowPaint
      className={nested ? className : undefined}
      layout={layout}
      legendLabel={copy("canvas.workflow.legend", "Legend")}
      spec={spec}
    />
  );
  if (nested) {
    return paint;
  }
  return (
    <WorldStage
      className={className}
      height={layout.height}
      padding={0}
      width={layout.width}
    >
      {paint}
    </WorldStage>
  );
}
