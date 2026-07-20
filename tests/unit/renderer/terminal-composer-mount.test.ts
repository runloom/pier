import { describe, expect, it } from "vitest";
import { shouldMountAgentComposer } from "../../../src/renderer/panel-kits/terminal/terminal-composer-mount.ts";

describe("shouldMountAgentComposer", () => {
  it("仅在开关开启 + agent 活动 + 非恢复态面板时挂载", () => {
    expect(
      shouldMountAgentComposer({
        activityKind: "agent",
        enabled: true,
        restored: false,
      })
    ).toBe(true);
    expect(
      shouldMountAgentComposer({
        activityKind: "shell",
        enabled: true,
        restored: false,
      })
    ).toBe(false);
    expect(
      shouldMountAgentComposer({
        activityKind: "task",
        enabled: true,
        restored: false,
      })
    ).toBe(false);
    expect(
      shouldMountAgentComposer({
        activityKind: undefined,
        enabled: true,
        restored: false,
      })
    ).toBe(false);
    expect(
      shouldMountAgentComposer({
        activityKind: "agent",
        enabled: false,
        restored: false,
      })
    ).toBe(false);
    expect(
      shouldMountAgentComposer({
        activityKind: "agent",
        enabled: true,
        restored: true,
      })
    ).toBe(false);
  });
});
