// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePlanDocument } from "../../../src/shared/contracts/project-plan.ts";
import {
  assertPlanAcyclic,
  edgesFromNodes,
  layeredLayout,
  type PlanNode,
  readPlanDocument,
  statusToColumn,
} from "../../../src/shared/project-plan-model.ts";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DOGFOOD_PLAN = join(
  REPO_ROOT,
  ".pier/plans/canvas-capabilities-v1/plan.json"
);

function node(
  id: string,
  deps: string[] = [],
  status: PlanNode["status"] = "todo"
): PlanNode {
  return { deps, id, status, title: id };
}

describe("project-plan", () => {
  it("parses a valid plan document", () => {
    const doc = parsePlanDocument({
      id: "demo",
      nodes: [node("a"), node("b", ["a"])],
      title: "Demo",
      updatedAt: "2026-07-26T00:00:00.000Z",
      version: 1,
    });
    expect(doc.nodes).toHaveLength(2);
    expect(doc.nodes[1]?.deps).toEqual(["a"]);
  });

  it("maps status to board columns", () => {
    expect(statusToColumn("todo")).toBe("backlog");
    expect(statusToColumn("in_progress")).toBe("doing");
    expect(statusToColumn("blocked")).toBe("review");
    expect(statusToColumn("done")).toBe("done");
    expect(statusToColumn("cancelled")).toBe("done");
  });

  it("rejects missing deps", () => {
    expect(() =>
      parsePlanDocument({
        id: "demo",
        nodes: [node("a", ["missing"])],
        title: "Demo",
        updatedAt: "2026-07-26T00:00:00.000Z",
        version: 1,
      })
    ).toThrow(/missing id/u);
  });

  it("rejects cycles", () => {
    expect(() =>
      assertPlanAcyclic([node("a", ["b"]), node("b", ["a"])])
    ).toThrow(/cycle/u);
  });

  it("layers nodes by longest dependency path", () => {
    const nodes = [
      node("a"),
      node("b", ["a"]),
      node("c", ["a"]),
      node("d", ["b", "c"]),
    ];
    const layout = layeredLayout(nodes, {
      gapX: 10,
      gapY: 10,
      nodeHeight: 40,
      nodeWidth: 100,
      paddingX: 0,
      paddingY: 0,
    });
    const byId = new Map(layout.nodes.map((item) => [item.id, item]));
    expect(byId.get("a")?.layer).toBe(0);
    expect(byId.get("b")?.layer).toBe(1);
    expect(byId.get("c")?.layer).toBe(1);
    expect(byId.get("d")?.layer).toBe(2);
    expect(byId.get("d")?.y).toBeGreaterThan(byId.get("b")?.y ?? 0);
  });

  it("derives edges from deps", () => {
    expect(edgesFromNodes([node("a"), node("b", ["a"])])).toEqual([
      { from: "a", to: "b" },
    ]);
  });

  it("parsePlanDocument accepts dogfood plan.json including brief", () => {
    const raw = JSON.parse(readFileSync(DOGFOOD_PLAN, "utf8")) as unknown;
    const doc = parsePlanDocument(raw);
    expect(doc.brief?.problem).toBeTruthy();
    expect(doc.nodes.length).toBeGreaterThan(0);
  });

  it("readPlanDocument preserves optional node fields", () => {
    const doc = readPlanDocument({
      id: "roundtrip",
      nodes: [
        {
          column: "doing",
          deps: [],
          docRefs: ["docs/a.canvas.tsx"],
          id: "n1",
          sessionRefs: [
            {
              boundAt: "2026-07-26T00:00:00.000Z",
              role: "implement",
              sessionId: "sess-1",
            },
          ],
          status: "in_progress",
          title: "Node",
        },
      ],
      title: "Roundtrip",
      updatedAt: "2026-07-26T00:00:00.000Z",
      version: 1,
    });
    expect(doc.nodes[0]?.column).toBe("doing");
    expect(doc.nodes[0]?.docRefs).toEqual(["docs/a.canvas.tsx"]);
    expect(doc.nodes[0]?.sessionRefs?.[0]?.sessionId).toBe("sess-1");
  });
});
