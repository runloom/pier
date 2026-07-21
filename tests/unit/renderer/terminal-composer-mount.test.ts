import { describe, expect, it } from "vitest";
import {
  canUseAgentComposer,
  shouldMountAgentComposer,
} from "../../../src/renderer/panel-kits/terminal/terminal-composer-mount.ts";

describe("canUseAgentComposer", () => {
  it("is true only for agent activity on a non-restored panel", () => {
    expect(
      canUseAgentComposer({
        activityKind: "agent",
        restored: false,
      })
    ).toBe(true);
  });

  it("is false for shell, task, undefined activity, or restored panels", () => {
    expect(
      canUseAgentComposer({
        activityKind: "shell",
        restored: false,
      })
    ).toBe(false);
    expect(
      canUseAgentComposer({
        activityKind: "task",
        restored: false,
      })
    ).toBe(false);
    expect(
      canUseAgentComposer({
        activityKind: undefined,
        restored: false,
      })
    ).toBe(false);
    expect(
      canUseAgentComposer({
        activityKind: "agent",
        restored: true,
      })
    ).toBe(false);
  });
});

describe("shouldMountAgentComposer", () => {
  it("mounts only when open and eligible", () => {
    expect(
      shouldMountAgentComposer({
        activityKind: "agent",
        open: true,
        restored: false,
      })
    ).toBe(true);
  });

  it("does not mount when open is false even if eligible", () => {
    expect(
      shouldMountAgentComposer({
        activityKind: "agent",
        open: false,
        restored: false,
      })
    ).toBe(false);
  });

  it("does not mount when ineligible even if open", () => {
    expect(
      shouldMountAgentComposer({
        activityKind: "shell",
        open: true,
        restored: false,
      })
    ).toBe(false);
    expect(
      shouldMountAgentComposer({
        activityKind: "agent",
        open: true,
        restored: true,
      })
    ).toBe(false);
    expect(
      shouldMountAgentComposer({
        activityKind: undefined,
        open: true,
        restored: false,
      })
    ).toBe(false);
  });
});
