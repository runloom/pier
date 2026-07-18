import { describe, expect, it } from "vitest";
import { filterByCoverageDate } from "../../../../src/main/services/agents/usage-collectors/date-range.ts";

describe("usage coverage date helpers", () => {
  it("filters cached observations that fell outside a sliding coverage window", () => {
    expect(
      filterByCoverageDate(
        [
          { date: "2026-06-01", id: "stale" },
          { date: "2026-07-01", id: "from-edge" },
          { date: "2026-07-10", id: "in-window" },
          { date: "2026-07-17", id: "to-edge" },
          { date: "2026-07-20", id: "future" },
        ],
        "2026-07-01",
        "2026-07-17"
      )
    ).toEqual([
      { date: "2026-07-01", id: "from-edge" },
      { date: "2026-07-10", id: "in-window" },
      { date: "2026-07-17", id: "to-edge" },
    ]);
  });
});
