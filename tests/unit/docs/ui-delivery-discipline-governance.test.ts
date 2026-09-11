import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HEADING = "## 06 设计稿与 UI 交付纪律（编码助手硬约定）";
const SAFETY_HEADING = "## 05 安全边界";

/** Rule titles in declared order; the marker is `N. **title。**`. */
const RULES = [
  "先列表，后动手",
  "留白即停下",
  "偏离先改规格",
  "产品原语优先，禁止手绘复制",
  "画布不是金标准",
  "能算的先算，只能看的必须看",
  "意见变断言",
] as const;

function agentsMd(): string {
  return readFileSync(join(ROOT, "AGENTS.md"), "utf8");
}

/** Body of §06: from its heading to the next top-level heading or EOF. */
function sectionBody(agents: string): string {
  const start = agents.indexOf(HEADING);
  if (start === -1) {
    throw new Error(`AGENTS.md is missing "${HEADING}"`);
  }
  const rest = agents.slice(start + HEADING.length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("ui delivery discipline (AGENTS.md §06)", () => {
  it("is a top-level section placed after 安全边界", () => {
    const agents = agentsMd();
    const safety = agents.indexOf(SAFETY_HEADING);
    expect(safety).toBeGreaterThan(-1);
    expect(agents.indexOf(HEADING)).toBeGreaterThan(safety);
  });

  it("keeps the seven numbered rules in declared order", () => {
    const body = sectionBody(agentsMd());
    let cursor = -1;
    for (const [index, rule] of RULES.entries()) {
      const marker = `${index + 1}. **${rule}。**`;
      const at = body.indexOf(marker);
      expect(at, marker).toBeGreaterThan(cursor);
      cursor = at;
    }
    // Adding a rule must update this lock, not slip past it.
    expect(body).not.toMatch(/^8\. /m);
  });

  it("names the contract / truth / memory triad and its checkpoints", () => {
    const body = sectionBody(agentsMd());
    expect(body).toContain("规格是合同，产品组件是视觉真源，测试是记忆");
    expect(body).toContain("`.pier/canvases/*`");
    expect(body).toContain("渲染截图");
    expect(body).toContain(
      "tests/unit/docs/ui-delivery-discipline-governance.test.ts"
    );
    expect(body).toContain("tests/unit/renderer/workbench/");
  });
});
