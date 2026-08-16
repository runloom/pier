import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANVAS_MATERIALS_FAMILY_IDS,
  CANVAS_MATERIALS_FORBIDDEN_ADOPTED_PHRASES,
  CANVAS_MATERIALS_FRAME_IDS,
  parseScheme,
} from "./model.ts";

const dir = import.meta.dirname;
const raw = readFileSync(join(dir, "data.json"), "utf8");

function cloneData(): { data: Record<string, unknown> } {
  return JSON.parse(raw) as { data: Record<string, unknown> };
}

describe("Canvas 物料金标准契约", () => {
  it("parseScheme 接受现行 data.json", () => {
    expect(() => parseScheme(raw)).not.toThrow();
    const scheme = parseScheme(raw);
    expect(scheme.schemaVersion).toBe(2);
    expect(scheme.data.families.map((family) => family.id)).toEqual([
      ...CANVAS_MATERIALS_FAMILY_IDS,
    ]);
    expect(scheme.data.productFrames.map((frame) => frame.id)).toEqual([
      ...CANVAS_MATERIALS_FRAME_IDS,
    ]);
    expect(
      scheme.data.alternatives.filter((row) => row.disposition === "adopt"),
    ).toHaveLength(1);
    expect(scheme.data.mainLoop.diagram.startsWith("flowchart ")).toBe(true);
    expect(scheme.data.architecture.diagram.startsWith("flowchart ")).toBe(true);
    expect(scheme.data.delivery.diagram.startsWith("flowchart ")).toBe(true);
    expect(scheme.data.acceptance.length).toBeGreaterThanOrEqual(6);
  });

  it("采纳路径禁止物料登记文件与声明命令", () => {
    const scheme = parseScheme(raw);
    const adopted = [
      scheme.data.bluf,
      scheme.data.insight,
      scheme.data.decision,
      ...scheme.data.goals,
      ...scheme.data.productFrames.map((frame) => `${frame.name} ${frame.spec}`),
      ...scheme.data.milestones.map((step) => step.deliver),
    ].join("\n");
    for (const phrase of CANVAS_MATERIALS_FORBIDDEN_ADOPTED_PHRASES) {
      expect(adopted, phrase).not.toContain(phrase);
    }
    expect(adopted).not.toContain("声明弹窗");
    expect(adopted).not.toContain("声明 Canvas 物料");
    expect(scheme.data.productFrames.some((frame) => frame.name.includes("声明"))).toBe(
      false,
    );
  });

  it("设计稿与相邻模块不出现登记文件、声明命令或项目树 Kit 文件", () => {
    const kit = readFileSync(join(dir, "kit-frames.tsx"), "utf8");
    const pages = readFileSync(join(dir, "kit-pages.tsx"), "utf8");
    const detail = readFileSync(join(dir, "kit-detail.tsx"), "utf8");
    const chrome = readFileSync(join(dir, "chrome.tsx"), "utf8");
    const entry = readFileSync(
      join(dir, "workbench-into-canvas.canvas.tsx"),
      "utf8",
    );
    const design = readFileSync(join(dir, "design-sections.tsx"), "utf8");
    const source = `${kit}\n${pages}\n${detail}\n${chrome}\n${entry}\n${design}`;
    expect(source).not.toContain("canvas-catalog.json");
    expect(source).not.toContain("pier.canvas.materials.declare");
    expect(source).not.toContain("声明 Canvas 物料");
    expect(source).not.toContain("声明项目物料");
    expect(source).not.toContain("kit.canvas.tsx");
    expect(kit).toContain("MaterialsDetailDialog");
    expect(kit).not.toContain("在面板中打开");
    expect(kit).not.toContain("打开 Canvas 物料");
    expect(kit).toContain("ArtboardStage");
    expect(kit).toContain("Artboard");
    expect(kit).not.toContain("<Screen");
    expect(chrome).toContain("项目");
    expect(chrome).not.toContain("Canvas 物料");
    expect(pages).toContain("MaterialsList");
    expect(pages).toContain("grid-cols-2");
    expect(pages).toContain("h-28");
    expect(pages).toContain('aria-label="物料类型"');
    expect(pages).toContain("inert");
    expect(pages).toContain("aria-hidden");
    expect(pages).toContain("focus-visible:ring-2");
    expect(pages).toContain("focus-visible:ring-ring/40");
    expect(pages).not.toContain("SelectTrigger");
    expect(pages).not.toContain("SelectContent");
    expect(pages).not.toContain("grid-cols-3");
    expect(pages).not.toContain("ItemMedia");
    expect(pages).not.toContain("ItemGroup");
    expect(pages).not.toContain("w-80");
    expect(pages).not.toContain("ToggleGroup");
    expect(pages).not.toContain("ItemActions");
    expect(kit).toContain('idPrefix="k1"');
    expect(kit).toContain('idPrefix="k2"');
    expect(kit).toContain('idPrefix="k3"');
    expect(kit).toContain("inert");
    expect(detail).toContain("aria-describedby");
    expect(pages).toContain(".canvas.tsx");
    expect(detail).toContain("接口");
    expect(detail).toContain("默认");
    expect(detail).toContain('role="dialog"');
    expect(detail).toContain("安装");
    expect(detail).toContain("用法");
    expect(detail).toContain("实样");
    expect(pages).not.toContain("KitPanelPreview");
    expect(design).toContain("KitFrames");
    expect(entry).not.toContain("KitFrames");
  });

  it("把登记文件写进决策会失败", () => {
    const injected = cloneData();
    injected.data.decision = `${String(injected.data.decision)} canvas-catalog.json`;
    expect(() => parseScheme(JSON.stringify(injected))).toThrow("登记产品");
  });

  it("把 Kit 文件写进主回路也会失败", () => {
    const injected = cloneData();
    const mainLoop = injected.data.mainLoop as { diagram: string };
    mainLoop.diagram = `${mainLoop.diagram}\n  X[kit.canvas.tsx]`;
    expect(() => parseScheme(JSON.stringify(injected))).toThrow("登记产品");
  });

  it("未知字段、缺家族、非 flowchart 会失败", () => {
    const extra = cloneData() as Record<string, unknown> & {
      data: Record<string, unknown>;
    };
    extra.extra = true;
    expect(() => parseScheme(JSON.stringify(extra))).toThrow("未知字段");

    const families = cloneData();
    families.data.families = (
      families.data.families as unknown[]
    ).slice(0, 2);
    expect(() => parseScheme(JSON.stringify(families))).toThrow("六类型");

    const loop = cloneData();
    const mainLoop = loop.data.mainLoop as { diagram: string };
    mainLoop.diagram = "sequenceDiagram\n  A-->B";
    expect(() => parseScheme(JSON.stringify(loop))).toThrow("flowchart");

    const bridged = cloneData();
    const bridgedLoop = bridged.data.mainLoop as { diagram: string };
    bridgedLoop.diagram =
      "flowchart LR\n  subgraph discover [看见]\n    List[卡片网格] --> Dialog[文档型弹窗]\n  end\n  subgraph author [生成]\n    Skill[生成]\n  end\n  Dialog --> Skill";
    expect(() => parseScheme(JSON.stringify(bridged))).toThrow("不得相连");

    const reverse = cloneData();
    const reverseLoop = reverse.data.mainLoop as { diagram: string };
    reverseLoop.diagram =
      "flowchart LR\n  subgraph discover [看见]\n    List[卡片网格]\n  end\n  subgraph author [生成]\n    Skill[生成]\n  end\n  Skill --> List";
    expect(() => parseScheme(JSON.stringify(reverse))).toThrow("不得相连");

    const dotted = cloneData();
    const dottedLoop = dotted.data.mainLoop as { diagram: string };
    dottedLoop.diagram =
      "flowchart LR\n  subgraph discover [看见]\n    List[卡片网格]\n  end\n  subgraph author [生成]\n    Skill[生成]\n  end\n  List -.-> Skill";
    expect(() => parseScheme(JSON.stringify(dotted))).toThrow("不得相连");

    const third = cloneData();
    const thirdLoop = third.data.mainLoop as { diagram: string };
    thirdLoop.diagram = `${String(thirdLoop.diagram)}\n  subgraph extra [其它]\n    X[x]\n  end`;
    expect(() => parseScheme(JSON.stringify(third))).toThrow("两个 subgraph");
  });

  it("采纳项必须恰好一条且不含登记文件", () => {
    const none = cloneData();
    none.data.alternatives = (
      none.data.alternatives as { disposition: string }[]
    ).map((row) => ({ ...row, disposition: "reject" }));
    expect(() => parseScheme(JSON.stringify(none))).toThrow("恰好一条");

    const adoptCatalog = cloneData();
    const alternatives = adoptCatalog.data.alternatives as {
      disposition: string;
      name: string;
      reason: string;
    }[];
    const adopt = alternatives.find((row) => row.disposition === "adopt");
    if (adopt) {
      adopt.reason = "写入 .pier/canvas-catalog 再生成";
    }
    expect(() => parseScheme(JSON.stringify(adoptCatalog))).toThrow("登记产品");
  });
});
