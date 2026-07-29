import { describe, expect, it } from "vitest";
import { parseGrokTaskUsage } from "../../../packages/plugin-grok/src/main/task-usage.ts";

describe("parseGrokTaskUsage", () => {
  it("maps frequent and occasional task buckets without fixed UI fields", () => {
    expect(
      parseGrokTaskUsage({
        tasks: {
          frequent: {
            limit: 20,
            remaining: 15,
            resetsAt: "2026-08-01T00:00:00Z",
          },
          occasional: { limit: 5, used: 2 },
        },
      })
    ).toEqual([
      expect.objectContaining({
        id: "grok:tasks:frequent",
        kind: "quota",
        usedPercent: 25,
      }),
      expect.objectContaining({
        id: "grok:tasks:occasional",
        kind: "quota",
        usedPercent: 40,
      }),
    ]);
  });

  it("keeps numeric future buckets as count metrics", () => {
    expect(parseGrokTaskUsage({ frequent: 3 })).toEqual([
      {
        format: "count",
        id: "grok:tasks:frequent",
        kind: "scalar",
        name: "Frequent tasks",
        value: 3,
      },
    ]);
  });
});
