import {
  nodeNeedsSlot,
  SLOT_ATTR,
  SLOT_CLASS,
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
    const withMeta = slotHeightPx({
      id: "c",
      kind: "tool",
      meta: "cli-human · catalog/start/turn/screen/wait",
      title: "Pier 智能体 CLI",
    });
    expect(withMeta).toBeGreaterThan(short);
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
});
