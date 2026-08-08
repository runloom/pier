import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PACKS_ROOT = join(
  process.cwd(),
  "resources/system-skills/pier-canvas/packs"
);

const REQUIRED_AXES = ["content", "presentation", "ui"] as const;

const REQUIRED_BY_AXIS: Record<(typeof REQUIRED_AXES)[number], string[]> = {
  content: ["design-doc", "closed-loop"],
  presentation: ["primary_nav_5", "one_pager"],
  ui: ["pier-default"],
};

function readPack(axis: string, id: string): Record<string, unknown> {
  const path = join(PACKS_ROOT, axis, id, "pack.json");
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("pier-canvas methodology packs", () => {
  it("ships required built-in packs with axis metadata", () => {
    for (const axis of REQUIRED_AXES) {
      const dir = join(PACKS_ROOT, axis);
      const ids = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      for (const required of REQUIRED_BY_AXIS[axis]) {
        expect(ids, `${axis} packs`).toContain(required);
        const pack = readPack(axis, required);
        expect(pack.schemaVersion).toBe(1);
        expect(pack.id).toBe(required);
        expect(pack.axis).toBe(axis);
        expect(typeof pack.title).toBe("string");
        expect(typeof pack.agentPrompt).toBe("string");
        expect(String(pack.agentPrompt).length).toBeGreaterThan(20);
      }
    }
  });

  it("presentation packs declare a single primary view and ≤5 views", () => {
    for (const id of REQUIRED_BY_AXIS.presentation) {
      const pack = readPack("presentation", id);
      const views = pack.views as { id: string; primary?: boolean }[];
      expect(Array.isArray(views)).toBe(true);
      expect(views.length).toBeGreaterThan(0);
      expect(views.length).toBeLessThanOrEqual(5);
      const primaries = views.filter((v) => v.primary === true);
      expect(primaries).toHaveLength(1);
    }
  });

  it("defaults match the methodology design contract", () => {
    const skill = readFileSync(
      join(process.cwd(), "resources/system-skills/pier-canvas/SKILL.md"),
      "utf8"
    );
    expect(skill).toContain("content");
    expect(skill).toContain("design-doc");
    expect(skill).toContain("primary_nav_5");
    expect(skill).toContain("pier-default");
    expect(skill).toContain("mode");
    expect(skill).toContain("methodology");
    expect(skill).toContain("freeform");
    // Product entry is skill invocation, not CLI
    expect(skill).toMatch(/\/pier-canvas/);
    expect(skill).toContain("not shell flags");
    expect(skill).toMatch(
      /Expression selection|static product design|Play\/Step/i
    );
  });

  it("documents expression selection and five-tab spine", () => {
    const methodology = readFileSync(
      join(
        process.cwd(),
        "resources/system-skills/pier-canvas/references/methodology.md"
      ),
      "utf8"
    );
    expect(methodology).toContain("Expression selection");
    expect(methodology).toContain("静态方案（默认）");
    expect(methodology).toContain("不为「显得高级」加演示");
    expect(methodology).toContain("Recommended information architecture");
    expect(methodology).toContain("速览");
    expect(methodology).toContain("落地");
  });

  it("overview template is a solid five-section product spine without demo chrome", () => {
    const template = readFileSync(
      join(
        process.cwd(),
        "resources/system-skills/pier-canvas/templates/overview.canvas.tsx"
      ),
      "utf8"
    );
    for (const id of ["overview", "problem", "design", "path", "landing"]) {
      expect(template).toContain(`value="${id}"`);
    }
    expect(template).toContain("速览");
    expect(template).toContain("问题");
    expect(template).toContain("设计");
    expect(template).toContain("日路径");
    expect(template).toContain("落地");
    expect(template).toContain("BLUF");
    expect(template).not.toMatch(/▶ 播放|单步|重置|useStepPlayer|DayPathDemo/);
    expect(template).toMatch(/无强制交互演示|静态/);
  });

  it("primary_nav_5 antiPatterns forbid fake demos on primary", () => {
    const pack = readPack("presentation", "primary_nav_5");
    const anti = pack.antiPatterns as string[];
    expect(anti.some((line) => /Play\/Step|demo chrome/i.test(line))).toBe(
      true
    );
    expect(anti.some((line) => /acceptance matrix|L0/i.test(line))).toBe(true);
    const views = pack.views as {
      id: string;
      label: string;
      primary?: boolean;
    }[];
    expect(views.map((v) => v.id)).toEqual([
      "overview",
      "problem",
      "design",
      "path",
      "landing",
    ]);
    expect(views.find((v) => v.primary)?.id).toBe("overview");
  });
});
