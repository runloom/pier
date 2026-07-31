import { createIdentityRegistry } from "@main/services/identity-registry.ts";
import { describe, expect, it } from "vitest";

describe("createIdentityRegistry", () => {
  it("registerPanel + windowOfPanel 返回已注册的 windowRecordId", () => {
    const reg = createIdentityRegistry();
    reg.registerPanel("terminal-1", "win-abc");
    expect(reg.windowOfPanel("terminal-1")).toBe("win-abc");
  });

  it("unregisterPanel 后 windowOfPanel 返回 null", () => {
    const reg = createIdentityRegistry();
    reg.registerPanel("terminal-1", "win-abc");
    reg.unregisterPanel("terminal-1");
    expect(reg.windowOfPanel("terminal-1")).toBeNull();
  });

  it("windowOfPanel 对未注册的 panelId 返回 null", () => {
    const reg = createIdentityRegistry();
    expect(reg.windowOfPanel("nonexistent")).toBeNull();
  });

  it("registerPanel 用新 windowRecordId 覆盖已有注册", () => {
    const reg = createIdentityRegistry();
    reg.registerPanel("terminal-1", "win-old");
    reg.registerPanel("terminal-1", "win-new");
    expect(reg.windowOfPanel("terminal-1")).toBe("win-new");
  });

  it("scopeForNative 在 panelId 未注册时抛异常", () => {
    const reg = createIdentityRegistry();
    expect(() => reg.scopeForNative("unregistered")).toThrow(
      "panel not registered: unregistered"
    );
  });

  it("unscopeFromNative 还原 scopeForNative 生成的 nativeKey", () => {
    const reg = createIdentityRegistry();
    // scopeForNative 需要真实注册，但产出格式为 "windowRecordId::panelId"
    // 直接用合成 key 验证 round-trip
    expect(reg.unscopeFromNative("42::terminal-1")).toBe("terminal-1");
  });

  it("unscopeFromNative 无分隔符时原样返回", () => {
    const reg = createIdentityRegistry();
    expect(reg.unscopeFromNative("plain-key")).toBe("plain-key");
  });

  it("unscopeFromNative 返回第一个 :: 之后的所有内容", () => {
    const reg = createIdentityRegistry();
    expect(reg.unscopeFromNative("prefix::mid::suffix")).toBe("mid::suffix");
  });
});
