import { describe, expect, it } from "vitest";
import {
  extractCursorTimeline,
  parseArgs,
  verdictFor,
} from "../../../scripts/probe-agent-cursor-semantics.mjs";

const ESC = String.fromCharCode(0x1b);
const SHOW = `${ESC}[?25h`;
const HIDE = `${ESC}[?25l`;

/**
 * 这个脚本只判断记录是否足以进入人工核对；不能替人断言
 * 「硬件光标可见 ⇔ 输入框聚焦」。
 */
describe("probe-agent-cursor-semantics 判读", () => {
  it("按 pnpm 实际透传形状解析脚本选项与被测命令", () => {
    expect(parseArgs(["--", "crush"])).toEqual({
      analyze: null,
      command: ["crush"],
      keep: false,
    });
    expect(parseArgs(["--keep", "--", "grok", "--model", "fast"])).toEqual({
      analyze: null,
      command: ["grok", "--model", "fast"],
      keep: true,
    });
    expect(parseArgs(["--analyze", "/tmp/session.log"])).toEqual({
      analyze: "/tmp/session.log",
      command: [],
      keep: false,
    });
  });

  it("只记录状态翻转，忽略每帧重发的同一模式位", () => {
    const raw = `boot${HIDE}${HIDE}${HIDE}${SHOW}${SHOW}${HIDE}`;
    const timeline = extractCursorTimeline(raw);

    expect(timeline.transitions.map((item) => item.state)).toEqual([
      "hidden",
      "visible",
      "hidden",
    ]);
    expect(timeline.final).toBe("hidden");
  });

  it("正文里的裸 [?25h 文本不算序列（须有 ESC 前缀）", () => {
    const timeline = extractCursorTimeline("docs say [?25h and [?25l\n");

    expect(timeline.transitions).toEqual([]);
    expect(timeline.final).toBeNull();
  });

  it("末态 visible 且完成多次翻转：只标记为人工核对候选", () => {
    const verdict = verdictFor(
      extractCursorTimeline(`x${HIDE}a${SHOW}b${HIDE}c${SHOW}`)
    );

    expect(verdict.candidate).toBe(true);
  });

  it("末态 hidden 且只有一次翻转：证据不足", () => {
    const verdict = verdictFor(extractCursorTimeline(`x${SHOW}a${HIDE}`));

    expect(verdict.candidate).toBe(false);
  });

  it("多次翻转即使末态 hidden 也可人工核对", () => {
    const verdict = verdictFor(
      extractCursorTimeline(`x${SHOW}a${HIDE}b${SHOW}c${HIDE}`)
    );

    expect(verdict.candidate).toBe(true);
  });

  it("全程无 ?25：禁止声明", () => {
    const verdict = verdictFor(extractCursorTimeline("plain output\n"));

    expect(verdict.candidate).toBe(false);
  });

  it("末态 visible 但无翻转：禁止声明（区分不出浏览态与聚焦态）", () => {
    const verdict = verdictFor(extractCursorTimeline(`boot${SHOW}steady`));

    expect(verdict.candidate).toBe(false);
  });

  it("只有一次 hidden → visible 不足以证明聚焦语义", () => {
    const verdict = verdictFor(extractCursorTimeline(`boot${HIDE}${SHOW}`));

    expect(verdict.candidate).toBe(false);
  });
});
