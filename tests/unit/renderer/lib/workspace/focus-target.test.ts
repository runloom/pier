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

  it("isActive 候选跳过 — 即使在方向上 overlap 最大", () => {
    // 诱饵 R1 (isActive=true) 与 R2 几何完全相同, 若算法漏了 isActive 跳过,
    // R1 先入循环, overlap 最大, 会把 bestIdx 锁在 1. 算法正确时必须落在 R2 (idx=2).
    const r1 = rect(105, 0, 100, 100);
    const r2 = rect(105, 0, 100, 100);
    const idx = pickFocusTarget(
      left,
      [
        mkCand("L", left, true),
        { id: "R1", isActive: true, rect: r1 }, // 诱饵
        mkCand("R2", r2),
      ],
      "right",
      TOL
    );
    expect(idx).toBe(2);
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
    const rightOverlap = rect(99, 0, 100, 100);
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true), mkCand("R", rightOverlap)],
      "right",
      TOL
    );
    expect(idx).toBe(1);
  });

  it("超出 tol 边界则不算同方向", () => {
    // 候选 left = 94, active.right = 100, gap = -6 比 tol=5 还多 1px, 判定不在右方向.
    // 与上一条 "容忍 gap 像素" 对照:99 内, 94 外, 验证 isInDirection 的 <= 比较精度.
    const tooMuchOverlap = rect(94, 0, 100, 100);
    const idx = pickFocusTarget(
      left,
      [mkCand("L", left, true), mkCand("R", tooMuchOverlap)],
      "right",
      TOL
    );
    expect(idx).toBe(null);
  });

  it("有候选但都不在方向上返回 null", () => {
    // 与 "方向上无邻居返回 null" 区分:那里测 candidates.length<2 边界,
    // 这里测 isActive 跳过 + inDir 全 false 的"实有候选但无方向匹配".
    // active = 中心 (50, 50, 100, 100); 候选在它左上, "right" 方向下全部 inDir=false.
    const center = rect(50, 50, 100, 100);
    const aboveLeft = rect(0, 0, 40, 40);
    const idx = pickFocusTarget(
      center,
      [mkCand("C", center, true), mkCand("AL", aboveLeft)],
      "right",
      TOL
    );
    expect(idx).toBe(null);
  });
});
