// src/main/menu/template-schema.test.ts
//
// Test isolation 策略: actionRegistry 是单例无 clear() — 每个用例用 **唯一 surface
// 字符串** 让 list(surface) 只返回本用例的 actions. 这里 schema 测试无 registry,
// 仅 schema in/out.

import { MenuTemplateSchema } from "@main/menu/template-schema.ts";
import { describe, expect, it } from "vitest";

describe("MenuTemplateSchema", () => {
  it("接受合法的 action 项", () => {
    const ok = [{ type: "action", id: "pier.x.y", label: "Do It" }];
    expect(MenuTemplateSchema.parse(ok)).toEqual(ok);
  });

  it("接受 separator + role", () => {
    const ok = [
      { type: "role", role: "copy" },
      { type: "separator" },
      { type: "action", id: "a.b", label: "X" },
    ];
    expect(() => MenuTemplateSchema.parse(ok)).not.toThrow();
  });

  it("拒绝非白名单 role", () => {
    expect(() =>
      MenuTemplateSchema.parse([{ type: "role", role: "quit" }])
    ).toThrow();
  });

  it("拒绝 top-level 超 50 项", () => {
    const big = Array.from({ length: 51 }, (_, i) => ({
      type: "action",
      id: `x.${i}`,
      label: `Item ${i}`,
    }));
    expect(() => MenuTemplateSchema.parse(big)).toThrow();
  });

  it("拒绝深度超过 5 的 submenu", () => {
    type AnyMenuItem = unknown;
    const build = (n: number): AnyMenuItem =>
      n === 0
        ? { type: "action", id: "leaf", label: "leaf" }
        : { type: "submenu", label: `L${n}`, submenu: [build(n - 1)] };
    expect(() => MenuTemplateSchema.parse([build(6)])).toThrow();
  });

  it("接受深度恰好 5 的 submenu", () => {
    type AnyMenuItem = unknown;
    const build = (n: number): AnyMenuItem =>
      n === 0
        ? { type: "action", id: "leaf", label: "leaf" }
        : { type: "submenu", label: `L${n}`, submenu: [build(n - 1)] };
    expect(() => MenuTemplateSchema.parse([build(5)])).not.toThrow();
  });

  it("拒绝 label 超过 256 字符", () => {
    const longLabel = "x".repeat(257);
    expect(() =>
      MenuTemplateSchema.parse([{ type: "action", id: "a", label: longLabel }])
    ).toThrow();
  });

  it("拒绝 accelerator 超过 64 字符", () => {
    expect(() =>
      MenuTemplateSchema.parse([
        {
          type: "action",
          id: "a",
          label: "x",
          accelerator: "x".repeat(65),
        },
      ])
    ).toThrow();
  });
});
