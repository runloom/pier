// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_EVIDENCE,
  INITIAL_COMPLETED,
  SURFACES,
  TASKS,
  taskLineageIds,
  taskStatus,
  validateTaskDependencies,
} from "../../../../.pier/canvases/canvas-capabilities/canvas-capabilities.model.ts";

describe("Canvas capability evidence model", () => {
  it("keeps the primary views focused and progressively disclosed", () => {
    expect(SURFACES.map((surface) => surface.id)).toEqual([
      "overview",
      "playground",
      "boundary",
      "verification",
      "route",
    ]);
  });

  it("requires an automated test source for every verified capability", () => {
    const verified = CAPABILITY_EVIDENCE.filter(
      (evidence) => evidence.state === "verified"
    );

    expect(verified).toHaveLength(3);
    for (const evidence of verified) {
      expect(evidence.source).toMatch(/^tests\//u);
      expect(evidence.gap.length).toBeGreaterThan(0);
    }
  });

  it("does not mark the multi-framework runtime complete from compilation alone", () => {
    const frameworks = CAPABILITY_EVIDENCE.find(
      (evidence) => evidence.id === "frameworks"
    );
    const task = TASKS.find((candidate) => candidate.id === "T7");

    expect(frameworks?.state).toBe("implemented");
    expect(INITIAL_COMPLETED).not.toContain("T7");
    expect(taskStatus(task!, new Set(INITIAL_COMPLETED))).toBe("ready");
  });

  it("keeps task dependency validation in the capability domain", () => {
    const tasks = [
      { deps: [], id: "T0" },
      { deps: ["T0"], id: "T1" },
      { deps: ["T0"], id: "T2" },
      { deps: ["T1", "T2"], id: "T3" },
    ] as const;

    expect(validateTaskDependencies()).toEqual({
      cycleTaskIds: [],
      unknownDependencies: [],
    });
    expect([...taskLineageIds(tasks, "T1")].sort()).toEqual(["T0", "T1", "T3"]);

    expect(
      validateTaskDependencies([
        { deps: ["T2"], id: "T1" },
        { deps: ["T1"], id: "T2" },
        { deps: ["T99"], id: "T3" },
      ])
    ).toEqual({
      cycleTaskIds: ["T1", "T2"],
      unknownDependencies: [{ dependencyId: "T99", taskId: "T3" }],
    });
  });
});
