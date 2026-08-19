import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildDeliveryDiagram,
  groupNotes,
  preferredDeliveryEdges,
  SCOPE_LABELS,
  scopeItemLabel,
  splitNote,
  topicForNote,
} from "./note-presentation.ts";

const root = dirname(fileURLToPath(import.meta.url));

function readSchemeData(): {
  scope: { pierOwns: string[]; callerOwns: string[] };
  architecture: { notes: string[] };
  phases: Array<{ wave: number; name: string }>;
} {
  const raw = JSON.parse(readFileSync(join(root, "data.json"), "utf8")) as {
    data: {
      scope: { pierOwns: string[]; callerOwns: string[] };
      architecture: { notes: string[] };
      phases: Array<{ wave: number; name: string }>;
    };
  };
  return raw.data;
}

describe("splitNote", () => {
  it("按中文分号拆成结论与细则", () => {
    expect(splitNote("结论句在前；细则在后。")).toEqual({
      summary: "结论句在前",
      detail: "细则在后。",
    });
  });

  it("按句号拆分且保留后续段落", () => {
    expect(splitNote("第一句。第二句仍在细则。")).toEqual({
      summary: "第一句。",
      detail: "第二句仍在细则。",
    });
  });

  it("无法安全拆分时全文作为摘要", () => {
    expect(splitNote("没有分隔符的一整句")).toEqual({
      summary: "没有分隔符的一整句",
      detail: null,
    });
  });
});

describe("topicForNote / groupNotes", () => {
  it("委派与并发优先于宽泛 invoke 规则", () => {
    const note =
      "默认能力只从父调用者派生到本次新建子运行；running invoke 与 starting/running child runtime 共享 maxActiveChildren 原子预留。";
    expect(topicForNote(note)).toBe("委派与并发");
  });

  it("人类与外部接入不被 invoke 宽规则抢走", () => {
    const note =
      "人类 CLI 与外部控制器复用相同命令和 refs；调用 invoke 时都必须取得精确 agent-invoke scope。";
    expect(topicForNote(note)).toBe("人类与外部接入");
  });

  it("对真实 architecture.notes 产出非空分组", () => {
    const { architecture } = readSchemeData();
    const groups = groupNotes(architecture.notes);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.reduce((n, g) => n + g.notes.length, 0)).toBe(architecture.notes.length);
  });
});

describe("scopeItemLabel", () => {
  it("为 pierOwns / callerOwns 全部 slug 提供中文标签且不截断", () => {
    const { scope } = readSchemeData();
    for (const slug of [...scope.pierOwns, ...scope.callerOwns]) {
      expect(SCOPE_LABELS[slug], `缺少中文标签：${slug}`).toBeDefined();
      const label = scopeItemLabel(slug);
      expect(label).not.toMatch(/…$/u);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("未知 slug 原样返回", () => {
    expect(scopeItemLabel("custom-unknown-slug")).toBe("custom-unknown-slug");
  });
});

describe("buildDeliveryDiagram", () => {
  it("对 W0–W6 生成 preferred 依赖边（含 W2∥W3）", () => {
    const { phases } = readSchemeData();
    const diagram = buildDeliveryDiagram(phases);
    for (const edge of preferredDeliveryEdges()) {
      expect(diagram.edges).toContainEqual(edge);
    }
    expect(
      diagram.nodes.find((node) => node.id === "W0")?.tone,
    ).toBe("success");
    expect(diagram.direction).toBe("top-to-bottom");
    for (const phase of phases) {
      expect(diagram.nodes.some((node) => node.id === `W${phase.wave}`)).toBe(
        true,
      );
    }
  });

  it("部分 wave 时不会留下无入边的孤立节点", () => {
    const diagram = buildDeliveryDiagram([
      { wave: 0, name: "边界" },
      { wave: 1, name: "身份" },
      { wave: 5, name: "协作" },
    ]);
    expect(diagram.edges).toContainEqual({ source: "W0", target: "W1" });
    expect(
      diagram.edges.some(
        (edge) =>
          (edge.source === "W1" && edge.target === "W5") ||
          (edge.source === "W0" && edge.target === "W5"),
      ),
    ).toBe(true);
  });
});
