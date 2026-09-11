import {
  workflowKindFill,
  workflowKindStroke,
} from "@pier/ui/canvas-workflow/kind.ts";
import {
  mermaidNodePaint,
  nodeNeedsSlot,
  SLOT_ATTR,
  SLOT_CLASS,
  SLOT_MIN_HEIGHT_PX,
  slotHeightPx,
} from "@pier/ui/mermaid/model.ts";
import { mermaidFlowchart } from "@pier/ui/mermaid/theme.ts";
import { describe, expect, it } from "vitest";

describe("Mermaid flowchart from nodes", () => {
  it("slots architecture nodes and keeps notation flowcharts as mermaid shapes", () => {
    const slotted = mermaidFlowchart({
      edges: [{ source: "host", target: "cli" }],
      nodes: [
        { id: "host", kind: "artifact", title: "Host" },
        { id: "cli", kind: "tool", title: "CLI" },
      ],
    });
    expect(slotted.startsWith("flowchart LR")).toBe(true);
    expect(slotted).toContain(`${SLOT_ATTR}='host'`);
    expect(slotted).toContain(`:::${SLOT_CLASS}`);
    expect(slotted).toContain("height:");
    expect(slotted).not.toContain("-.->");
    expect(nodeNeedsSlot({ id: "host", kind: "artifact", title: "Host" })).toBe(
      true
    );

    const notation = mermaidFlowchart({
      edges: [
        { source: "start", target: "check" },
        { source: "check", target: "done" },
      ],
      nodes: [
        { id: "start", shape: "round", title: "Start" },
        { id: "check", shape: "diamond", title: "Decide" },
        { id: "done", shape: "rect", title: "Done" },
      ],
    });
    expect(notation).toContain("start(Start)");
    expect(notation).toContain("check{Decide}");
    expect(notation).toContain('done["Done"]');
    expect(notation).not.toContain(SLOT_ATTR);
    expect(nodeNeedsSlot({ id: "n", title: "Neutral" })).toBe(true);
    expect(nodeNeedsSlot({ id: "d", shape: "rect", title: "Done" })).toBe(
      false
    );
  });

  it("reserves mermaid htmlLabel height for wrapped title and meta", () => {
    const short = slotHeightPx({ id: "h", kind: "actor", title: "人类" });
    const ascii = slotHeightPx({
      id: "file",
      kind: "artifact",
      title: "Canvas file",
    });
    const withMeta = slotHeightPx({
      id: "c",
      kind: "tool",
      meta: "cli-human · catalog/start/turn/screen/wait",
      title: "Pier 智能体 CLI",
    });
    // One-line titles (CJK or short ASCII) share the same slot; do not
    // reserve a second title line that shows up as empty card padding.
    expect(ascii).toBe(short);
    expect(ascii).toBe(SLOT_MIN_HEIGHT_PX);
    expect(ascii).toBe(slotHeightPx({ id: "t", kind: "tool", title: "CLI" }));
    // 12 CJK × 14px = 168 > title col 165 once the 1.5px hairline is
    // subtracted; CSS break-words wraps the last glyph onto line 2.
    const twelveCjk = slotHeightPx({
      id: "cjk12",
      kind: "actor",
      title: "一二三四五六七八九十壹贰",
    });
    expect(twelveCjk).toBeGreaterThan(SLOT_MIN_HEIGHT_PX);
    expect(twelveCjk).toBe(SLOT_MIN_HEIGHT_PX + 20);
    // Meta wraps on whitespace, then breaks the 30-char slash token (3 lines).
    expect(withMeta).toBe(SLOT_MIN_HEIGHT_PX + 4 + 3 * 16);
    const source = mermaidFlowchart({
      edges: [],
      nodes: [
        {
          id: "c",
          kind: "tool",
          meta: "cli-human · catalog/start/turn/screen/wait",
          title: "Pier 智能体 CLI",
        },
      ],
    });
    expect(source).toContain(`height:${withMeta}px`);
    const wrapped = slotHeightPx({
      id: "issue",
      kind: "tool",
      title: "已落地 · 不建第一版实现任务依赖 DAG",
    });
    expect(wrapped).toBeGreaterThan(short);
    expect(wrapped).toBeGreaterThan(
      slotHeightPx({ id: "t", kind: "tool", title: "CLI" })
    );
  });

  it("paints mermaid kind/tone with the WorkflowDiagram color-mix recipe", () => {
    expect(mermaidNodePaint({ kind: "actor" })).toEqual({
      dashed: false,
      fill: workflowKindFill("step"),
      stroke: workflowKindStroke("step"),
    });
    expect(mermaidNodePaint({ kind: "tool" })).toEqual({
      dashed: false,
      fill: workflowKindFill("store"),
      stroke: workflowKindStroke("store"),
    });
    expect(mermaidNodePaint({ kind: "external" })).toEqual({
      dashed: true,
      fill: workflowKindFill("external"),
      stroke: workflowKindStroke("external"),
    });
    expect(mermaidNodePaint({ kind: "artifact" })).toEqual({
      dashed: true,
      fill: workflowKindFill("step"),
      stroke: workflowKindStroke("step"),
    });
    expect(mermaidNodePaint({ kind: "agent" })).toEqual({
      dashed: false,
      fill: "color-mix(in srgb, var(--status-done-fg) 18%, var(--card))",
      stroke: "var(--status-done-fg)",
    });
    expect(mermaidNodePaint({ tone: "danger" })).toEqual({
      dashed: false,
      fill: workflowKindFill("gate"),
      stroke: workflowKindStroke("gate"),
    });
    expect(mermaidNodePaint({ tone: "warning" })).toEqual({
      dashed: false,
      fill: workflowKindFill("system"),
      stroke: workflowKindStroke("system"),
    });
    expect(mermaidNodePaint({ kind: "tool", tone: "danger" })).toEqual({
      dashed: false,
      fill: workflowKindFill("gate"),
      stroke: workflowKindStroke("gate"),
    });
    expect(mermaidNodePaint({})).toEqual({
      dashed: false,
      fill: undefined,
      stroke: undefined,
    });
  });
});
