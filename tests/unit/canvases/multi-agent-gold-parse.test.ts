/**
 * 金标准 data.json 可被 model.parseScheme 接受（产品身份 v8.2 收敛后）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("multi-agent-orchestration-gold data.json", () => {
  it("parseScheme accepts v8.2 cli-human product model", async () => {
    const { parseScheme } = await import(
      "../../../.pier/canvases/multi-agent-orchestration-gold/model.ts"
    );
    const raw = readFileSync(
      join(
        process.cwd(),
        ".pier/canvases/multi-agent-orchestration-gold/data.json"
      ),
      "utf8"
    );
    expect(() => parseScheme(raw)).not.toThrow();
    const data = JSON.parse(raw) as {
      data: {
        meta: { version: string };
        bluf: string;
        productNonGoals: string[];
      };
    };
    expect(data.data.meta.version).toBe("v8.2");
    expect(data.data.bluf).toMatch(/cli-human/u);

    expect(
      data.data.productNonGoals.some(
        (g) =>
          g.includes("AccessGrant") ||
          g.includes("access.*") ||
          g.includes("external")
      )
    ).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/已删除|遗留\/实验/u);
    const notes = (
      data as {
        data: {
          architecture?: { notes?: string[] };
          productNonGoals: string[];
        };
      }
    ).data;
    const goals = notes.productNonGoals;
    expect(new Set(goals).size).toBe(goals.length);
  });
});
