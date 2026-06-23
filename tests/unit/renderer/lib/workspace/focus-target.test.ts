import { describe, expect, it } from "vitest";
import {
  type GroupCandidate,
  pickFocusTarget,
} from "@/lib/workspace/focus-target.ts";

function rect(x: number, y: number, w: number, h: number): DOMRect {
  // DOMRect 在 node 环境不存在, 用 plain object 满足结构.
  return {
    x,
    y,
    width: w,
    height: h,
    top: y,
    left: x,
    right: x + w,
    bottom: y + h,
    toJSON: () => "",
  } as DOMRect;
}

function mkCand(id: string, r: DOMRect, isActive = false): GroupCandidate {
  return { id, isActive, rect: r };
}

const TOL = 5;

describe("pickFocusTarget", () => {
  // 布局: 左 (0,0,100,100), 右 (105,0,100,100). gap=5.
  const left = rect(0, 0, 100, 100);
  const right = rect(105, 0, 100, 100);

  it("右邻命中", () => {
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true), mkCand("R", right)],
      "right",
      TOL
    );
    expect(idx).toBe(1);
  });

  it("左邻命中", () => {
    const idx = pickFocusTarget(
      right,
      [mkCand("L", left), mkCand("R", right, true)],
      "left",
      TOL
    );
    expect(idx).toBe(0);
  });

  it("下邻命中", () => {
    const top = rect(0, 0, 100, 100);
    const bottom = rect(0, 105, 100, 100);
    const idx = pickFocusTarget(
      top,
      [mkCand("T", top, true), mkCand("B", bottom)],
      "down",
      TOL
    );
    expect(idx).toBe(1);
  });

  it("上邻命中", () => {
    const top = rect(0, 0, 100, 100);
    const bottom = rect(0, 105, 100, 100);
    const idx = pickFocusTarget(
      bottom,
      [mkCand("T", top), mkCand("B", bottom, true)],
      "up",
      TOL
    );
    expect(idx).toBe(0);
  });

  it("方向上无邻居返回 null", () => {
    // active = left, 候选只有 active 自己 → 没有右邻
    const idx = pickFocusTarget(left, [mkCand("L", left, true)], "right", TOL);
    expect(idx).toBe(null);
  });

  it("isActive 候选跳过", () => {
    // active 在 left, candidates 含 active 自己 — pickFocusTarget 必须跳过 isActive
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true), mkCand("R", right)],
      "right",
      TOL
    );
    expect(idx).toBe(1);
  });

  it("rect == null 的候选跳过", () => {
    const idx = pickFocusTarget(
      left,
      [
        mkCand("L", left, true),
        { id: "ghost", isActive: false, rect: null },
        mkCand("R", right),
      ],
      "right",
      TOL
    );
    expect(idx).toBe(2);
  });

  it("重叠平分时取中心更近", () => {
    // 两个右邻, 都与 active 完全重叠 y 范围, 但中心 y 不同.
    // active 中心 y = 50; A 中心 y = 50 (近), B 中心 y = 30 (远).
    const a = rect(105, 0, 100, 100); // y center 50
    const b = rect(105, 0, 100, 60); // y center 30
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true), mkCand("A", a), mkCand("B", b)],
      "right",
      TOL
    );
    expect(idx).toBe(1); // A 更近
  });

  it("重叠不同时取重叠更大", () => {
    // A 在右且完全 y 覆盖 active (100% 重叠)
    // B 在右但 y 只覆盖一半 (50% 重叠)
    const a = rect(105, 0, 100, 100);
    const b = rect(105, 0, 100, 50);
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true), mkCand("A", a), mkCand("B", b)],
      "right",
      TOL
    );
    expect(idx).toBe(1); // A 重叠更大
  });

  it("容忍 gap 像素 — tol 内的偏差仍算在方向上", () => {
    // 右邻 left = 99 (比 active.right=100 还小 1px), 但 tol=5 容忍, 仍判右
    const right_overlap = rect(99, 0, 100, 100);
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true), mkCand("R", right_overlap)],
      "right",
      TOL
    );
    expect(idx).toBe(1);
  });

  it("候选不足 (只有 active) 返回 null", () => {
    const idx = pickFocusTarget(left, [mkCand("L", left, true)], "right", TOL);
    expect(idx).toBe(null);
  });
});
