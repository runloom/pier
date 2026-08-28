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
  presentation: ["decision_nav_4", "primary_nav_5", "one_pager"],
  ui: ["pier-default"],
};

function readPack(axis: string, id: string): Record<string, unknown> {
  const path = join(PACKS_ROOT, axis, id, "pack.json");
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function readNavGlossary(): {
  fallback: string;
  labels: Record<string, Record<string, string>>;
} {
  return JSON.parse(
    readFileSync(
      join(process.cwd(), "resources/system-skills/pier-canvas/i18n/nav.json"),
      "utf8"
    )
  ) as { fallback: string; labels: Record<string, Record<string, string>> };
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

  it("nav glossary covers every presentation view id and requires en", () => {
    const nav = readNavGlossary();
    expect(nav.fallback).toBe("en");
    for (const id of REQUIRED_BY_AXIS.presentation) {
      const pack = readPack("presentation", id);
      const views = pack.views as { id: string }[];
      for (const view of views) {
        expect(
          nav.labels[view.id]?.en,
          `${id}.${view.id} missing en in i18n/nav.json`
        ).toBeTruthy();
      }
    }
  });

  it("presentation packs declare a single primary view and ≤5 views", () => {
    for (const id of REQUIRED_BY_AXIS.presentation) {
      const pack = readPack("presentation", id);
      const views = pack.views as {
        id: string;
        label: string;
        primary?: boolean;
      }[];
      expect(Array.isArray(views)).toBe(true);
      expect(views.length).toBeGreaterThan(0);
      expect(views.length).toBeLessThanOrEqual(5);
      const primaries = views.filter((v) => v.primary === true);
      expect(primaries).toHaveLength(1);
      for (const view of views) {
        expect(typeof view.label).toBe("string");
      }
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
    expect(skill).toContain("decision_nav_4");
    expect(skill).toContain("pier-default");
    expect(skill).toContain("Pack selection");
    expect(skill).toContain("mode");
    expect(skill).toContain("methodology");
    expect(skill).toContain("freeform");
    expect(skill).toContain("Stage selection");
    // Shell inventory + auto-selection (docs shell carries its own chrome).
    expect(skill).toContain("DocsShell");
    expect(skill).toContain("Pick the shell from the user's ask");
    expect(skill).toContain("no floating font-scale control");
    expect(skill).toContain("recipe=design");
    expect(skill).toContain("recipe=orchestration");
    expect(skill).toContain("recipe=board");
    expect(skill).toContain("WorldStage");
    expect(skill).toContain("<Stack fill>");
    expect(skill).toContain("Audience language");
    expect(skill).toContain("i18n/nav.json");
    expect(skill).toContain("locale");
    // Product entry is skill invocation, not CLI
    expect(skill).toMatch(/\/pier-canvas/);
    expect(skill).toContain("not shell flags");
    expect(skill).toContain(".pier/canvases/canvas-kit/canvas-kit.canvas.tsx");
    expect(skill).toContain("Only import named exports");
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
    expect(methodology).toContain("Pack selection");
    expect(methodology).toContain("decision_nav_4");
    expect(methodology).toContain("Day 1");
    expect(methodology).toContain("Overview");
    expect(methodology).toContain("Landing");
    expect(methodology).toContain("i18n/nav.json");
  });

  it("documents Mermaid kind versus tone for authors", () => {
    const authoring = readFileSync(
      join(
        process.cwd(),
        "resources/system-skills/pier-canvas/references/authoring.md"
      ),
      "utf8"
    );
    const skill = readFileSync(
      join(process.cwd(), "resources/system-skills/pier-canvas/SKILL.md"),
      "utf8"
    );
    expect(authoring).toContain("## Mermaid");
    expect(authoring).toContain("`kind`");
    expect(authoring).toContain("`tone`");
    expect(authoring).toContain("`source`");
    expect(authoring).toContain("`sequence`");
    expect(authoring).toContain("`class`");
    expect(authoring).toContain("No left color rail");
    expect(skill).toContain("Mermaid chrome");
    expect(skill).toContain("actor");
    expect(skill).toContain("`sequence`");
  });

  it("resolves presentation from content (design-doc has no 首日 tab)", () => {
    const design = readPack("content", "design-doc");
    const loop = readPack("content", "closed-loop");
    expect(design.preferredPresentation).toBe("decision_nav_4");
    expect(loop.preferredPresentation).toBe("primary_nav_5");

    const four = readPack("presentation", "decision_nav_4");
    const five = readPack("presentation", "primary_nav_5");
    expect(four.fitsContent).toEqual(["design-doc"]);
    expect(five.fitsContent).toEqual(["closed-loop"]);
    expect((four.views as { id: string }[]).map((v) => v.id)).toEqual([
      "overview",
      "problem",
      "design",
      "landing",
    ]);
    const pathView = (five.views as { id: string; label: string }[]).find(
      (v) => v.id === "path"
    );
    expect(pathView?.label).toBe("Day 1");
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
    expect(template).toContain("Overview");
    expect(template).toContain("Problem");
    expect(template).toContain("Design");
    expect(template).toContain("Day 1");
    expect(template).toContain("Landing");
    expect(template).toContain("BLUF");
    expect(template).toMatch(/user-visible string|user's language/i);
    expect(template).not.toMatch(/▶ 播放|单步|重置|useStepPlayer|DayPathDemo/);
    expect(template).toMatch(/No required interactive demo|static/i);
  });

  it("decision template is a four-section spine without Day-1 chrome", () => {
    const template = readFileSync(
      join(
        process.cwd(),
        "resources/system-skills/pier-canvas/templates/decision.canvas.tsx"
      ),
      "utf8"
    );
    for (const id of ["overview", "problem", "design", "landing"]) {
      expect(template).toContain(`value="${id}"`);
    }
    expect(template).not.toContain('value="path"');
    expect(template).not.toContain("日路径");
    expect(template).toContain("decision_nav_4");
    expect(template).toContain("BLUF");
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

  it("ships freeform recipe packs that are not methodology axes", () => {
    const recipes = [
      { id: "design", stage: "world" },
      { id: "orchestration", stage: "world" },
      { id: "board", stage: "fill" },
    ] as const;
    for (const recipe of recipes) {
      const pack = JSON.parse(
        readFileSync(
          join(PACKS_ROOT, "recipes", recipe.id, "pack.json"),
          "utf8"
        )
      ) as Record<string, unknown>;
      expect(pack.schemaVersion).toBe(1);
      expect(pack.id).toBe(recipe.id);
      expect(pack.axis).toBe("recipe");
      expect(pack.stage).toBe(recipe.stage);
      expect(typeof pack.agentPrompt).toBe("string");
      expect(String(pack.agentPrompt).length).toBeGreaterThan(20);
    }
    const skill = readFileSync(
      join(process.cwd(), "resources/system-skills/pier-canvas/SKILL.md"),
      "utf8"
    );
    expect(skill).toContain("packs/recipes/design/");
    expect(skill).toContain("packs/recipes/board/");
    expect(skill).toContain("templates/design-mockup.canvas.tsx");
    expect(skill).toContain("templates/dag-viewer.canvas.tsx");
    expect(skill).toContain("templates/kanban.canvas.tsx");
    expect(skill).toContain("recipe=board");
    const hostData = readFileSync(
      join(
        process.cwd(),
        "resources/system-skills/pier-canvas/references/host-data.md"
      ),
      "utf8"
    );
    expect(hostData).toContain("http://127.0.0.1");
    expect(hostData).toContain("invokeCommand");
    expect(hostData).toContain("Do not call");
    expect(hostData).toContain("run.spawn");
  });
});
