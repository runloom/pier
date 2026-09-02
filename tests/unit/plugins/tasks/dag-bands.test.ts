import { describe, expect, it } from "vitest";
import { dagSections } from "../../../../packages/plugin-tasks/applets/task-dag/bands.ts";

describe("task DAG bands", () => {
  it("uses a stable cycle id instead of an English label", () => {
    const cardByKey = new Map([
      ["a", { work: null }],
      ["b", { work: null }],
    ]);
    const sections = dagSections({
      cardByKey: cardByKey as never,
      cycleKeys: new Set(["a", "b"]),
      doneKeys: new Set(),
      layers: [["a", "b"]],
    });
    expect(sections).toEqual([{ danger: true, id: "cycle", keys: ["a", "b"] }]);
  });
});
