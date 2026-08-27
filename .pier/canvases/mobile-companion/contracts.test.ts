import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePierCanvasMeta } from "../../../src/shared/contracts/pier-canvas.ts";
import { data, WIREFRAME_IDS } from "./model.ts";

const dir = import.meta.dirname;

describe("移动端画布契约", () => {
  it("data.json 通过 content 门禁", () => {
    expect(data.schemaVersion).toBe(1);
    expect(data.bluf.length).toBeGreaterThan(20);
    expect(data.bluf.length).toBeLessThanOrEqual(280);
    expect(data.goals.length).toBeGreaterThanOrEqual(2);
    expect(data.nonGoals.length).toBeGreaterThanOrEqual(2);
    expect(data.wireframes.map((frame) => frame.id)).toEqual([...WIREFRAME_IDS]);
    expect(data.design.loopDiagram.nodes.every((node) => node.kind)).toBe(true);
    expect(data.design.journeyDiagram.nodes.every((node) => node.kind)).toBe(
      true
    );
    expect(data.design.connectSequence.startsWith("sequenceDiagram")).toBe(
      true
    );
    expect(data.design.connectSequence).toContain("alt 本机没有令牌");
    expect(data.design.connectSequence).toContain("else 本机已有令牌");
    expect(data.design.connectSequence).toContain("Pier 会合");
    expect(data.design.connectSequence).toContain("alt 同网");
    expect(data.design.connectSequence).toContain("else 远程");
    expect(data.design.connectSequence).toContain("不开放公网入站");
    expect(data.design.connectSequence).toContain("官方 HTTPS origin");
    expect(data.design.connectSequence).toContain("吊销立即断开已连会话");
    expect(
      data.design.journeyDiagram.nodes.some((node) => node.id === "cloud")
    ).toBe(true);
    expect(
      data.design.journeyDiagram.nodes.find((node) => node.id === "mac")?.title
    ).toBe("桌面宿主");
    expect(
      data.design.journeyDiagram.nodes.some((node) => node.id === "wake")
    ).toBe(true);
    expect(data.coreLoop).toHaveLength(6);
    expect(data.coreLoop.map((row) => row.step)).toEqual([
      "配对一次",
      "打开见主机",
      "投影会话",
      "就地闭环",
      "远程仍在",
      "离开能叫醒",
    ]);
    expect(data.alternatives.map((row) => row.name)).toContain(
      "远程默认自备主机地址或仅自托管"
    );
    expect(data.alternatives.map((row) => row.name)).toContain(
      "仅局域网切片即对外交付"
    );
    expect(data.alternatives.map((row) => row.name)).toContain(
      "叫醒排到终端增强之后"
    );
    expect(data.alternatives.map((row) => row.name)).toContain(
      "远程访问开后不监听任何端口"
    );
    expect(data.alternatives.map((row) => row.name)).toContain(
      "吊销只作废令牌、不断开已连会话"
    );
    expect(data.alternatives.map((row) => row.name)).toContain(
      "把 Web 令牌写入局域网 origin"
    );
    expect(data.milestones.find((row) => row.id === "M2")?.kind).toBe(
      "核心交付"
    );
    expect(data.milestones.find((row) => row.id === "M1")?.kind).toBe(
      "内部切片"
    );
    expect(data.milestones.find((row) => row.id === "M2")?.deliver).toContain(
      "叫醒"
    );
    expect(data.landingLead).toContain("第一条可交付产品线");
    expect(data.wireframes.find((frame) => frame.id === "S1")?.description).toContain(
      "当前屏幕"
    );
    expect(data.wireframes.find((frame) => frame.id === "S1")?.description).toContain(
      "仅 D2"
    );
    expect(data.design.layers.some((layer) => layer.startsWith("路径："))).toBe(
      true
    );
    expect(
      data.design.layers.some((layer) => layer.startsWith("Web origin："))
    ).toBe(true);
    expect(
      data.design.loopDiagram.nodes.find((node) => node.id === "web")?.meta
    ).toContain("官方 HTTPS");
    expect(data.coreLoop.find((row) => row.step === "远程仍在")?.sense).toContain(
      "跨网"
    );
    expect(data.milestones.find((row) => row.id === "M2")?.deliver).toContain(
      "HTTPS origin"
    );
    expect(data.acceptance.join("\n")).toContain("跨网只出站");
    expect(data.acceptance.join("\n")).toContain("吊销后已连会话");
    expect(data.acceptance.join("\n")).toContain("官方 HTTPS origin");
    expect(data.acceptance.join("\n")).toContain("未授 D2");
  });

  it("根面是主机而不是活动总览，T1 不写 scrollback", () => {
    expect(data.wireframes[0]?.id).toBe("QR");
    expect(data.wireframes.map((frame) => frame.title)).not.toContain(
      "活动总览"
    );
    expect(data.wireframes.map((frame) => frame.id)).toEqual([
      "QR",
      "H0",
      "H1",
      "H2",
      "S1",
      "S2",
      "S3",
      "N1",
    ]);
    const banned = ["完整历史", "scrollback 投影", "家里电脑", "家里地址", "伴侣"];
    const hostScreens = readFileSync(join(dir, "host-screens.tsx"), "utf8");
    const sessionScreens = readFileSync(join(dir, "session-screens.tsx"), "utf8");
    const chrome = readFileSync(join(dir, "chrome.tsx"), "utf8");
    const corpus = [
      data.bluf,
      data.context,
      ...data.pains,
      ...data.goals,
      ...data.coreLoop.map((row) => `${row.step} ${row.sense} ${row.broken}`),
      ...data.wireframes.map((frame) => `${frame.title} ${frame.description}`),
      ...data.milestones.map((row) => row.deliver),
      ...data.alternatives.map((row) => `${row.name} ${row.rejectReason}`),
      hostScreens,
      sessionScreens,
      chrome,
    ].join("\n");
    for (const phrase of banned) {
      expect(corpus).not.toContain(phrase);
    }
    expect(hostScreens).toContain("不开放公网入站");
    expect(hostScreens).not.toContain("不开放入站端口");
    expect(hostScreens).toContain("已连会话立即断开");
    expect(sessionScreens).toContain("未授权则隐藏");
    expect(sessionScreens).not.toContain("function Keys");
    expect(chrome).not.toContain("function Keys");
  });

  it("入口是 composition 总览且设计页使用 Artboard 线框", () => {
    const entry = readFileSync(join(dir, "mobile-companion.canvas.tsx"), "utf8");
    const frames = readFileSync(join(dir, "wireframes.tsx"), "utf8");
    const instance = JSON.parse(
      readFileSync(join(dir, "instance.json"), "utf8")
    ) as {
      content: string;
      presentation: string;
      role: string;
      ui: string;
    };
    expect(
      parsePierCanvasMeta({ kind: "composition", title: "Pier 移动端" })
    ).not.toBeNull();
    expect(entry).toContain('kind: "composition"');
    expect(entry).toContain("速览");
    expect(entry).not.toContain("首日");
    expect(entry).not.toContain("cursor/canvas");
    expect(entry).not.toContain("window.pier");
    expect(frames).toContain("ArtboardStage");
    expect(frames).toContain("Artboard");
    expect(frames).toContain("PHONE_W");
    expect(frames).toContain("PHONE_H");
    expect(instance).toEqual({
      schemaVersion: 1,
      content: "design-doc",
      presentation: "decision_nav_4",
      ui: "pier-default",
      status: "draft",
      role: "overview",
    });
  });

  it("规格自有章节不再写家里电脑，并锁住吊销 epoch", () => {
    const spec = readFileSync(
      join(
        dir,
        "../../../docs/superpowers/specs/2026-08-26-mobile-companion-design.md"
      ),
      "utf8"
    );
    expect(spec).not.toContain("家里电脑");
    expect(spec).not.toContain("家里那台电脑");
    expect(spec).not.toContain("伴侣");
    expect(spec).toContain("Pier 移动端");
    expect(spec).toContain("tokenEpoch");
    expect(spec).toContain("device_revoked");
    expect(spec).toContain("官方会合 HTTPS（PWA）");
  });
});
