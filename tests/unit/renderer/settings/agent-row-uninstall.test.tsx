import { describe, expect, it } from "vitest";
import {
  formatUninstallConfirmBody,
  shouldShowAgentUninstall,
} from "../../../../src/renderer/pages/settings/components/agent-row-uninstall.tsx";

const t = ((key: string, opts?: Record<string, unknown>) => {
  if (!opts) {
    return key;
  }
  return `${key}:${JSON.stringify(opts)}`;
}) as never;

describe("shouldShowAgentUninstall", () => {
  it("guided + custom → false", () => {
    expect(
      shouldShowAgentUninstall({
        isBusy: false,
        isDetected: true,
        support: "guided",
        canUninstall: false,
        hasCustomUninstallCommand: true,
      })
    ).toBe(false);
  });

  it("full + path + custom → true", () => {
    expect(
      shouldShowAgentUninstall({
        isBusy: false,
        isDetected: true,
        support: "full",
        canUninstall: false,
        hasCustomUninstallCommand: true,
      })
    ).toBe(true);
  });

  it("full + managed canUninstall → true", () => {
    expect(
      shouldShowAgentUninstall({
        isBusy: false,
        isDetected: true,
        support: "full",
        canUninstall: true,
        hasCustomUninstallCommand: false,
      })
    ).toBe(true);
  });

  it("busy → false", () => {
    expect(
      shouldShowAgentUninstall({
        isBusy: true,
        isDetected: true,
        support: "full",
        canUninstall: true,
        hasCustomUninstallCommand: false,
      })
    ).toBe(false);
  });

  it("not detected → false", () => {
    expect(
      shouldShowAgentUninstall({
        isBusy: false,
        isDetected: false,
        support: "full",
        canUninstall: true,
        hasCustomUninstallCommand: false,
      })
    ).toBe(false);
  });

  it("full + neither managed nor custom → false", () => {
    expect(
      shouldShowAgentUninstall({
        isBusy: false,
        isDetected: true,
        support: "full",
        canUninstall: false,
        hasCustomUninstallCommand: false,
      })
    ).toBe(false);
  });

  it("support none → false", () => {
    expect(
      shouldShowAgentUninstall({
        isBusy: false,
        isDetected: true,
        support: "none",
        canUninstall: true,
        hasCustomUninstallCommand: true,
      })
    ).toBe(false);
  });
});

describe("formatUninstallConfirmBody", () => {
  it("includes source and path when both present", () => {
    expect(
      formatUninstallConfirmBody(t, {
        name: "Claude Code",
        path: "/usr/local/bin/claude",
        source: "brew",
      })
    ).toBe(
      'settings.agents.action.uninstallConfirmBody:{"name":"Claude Code","path":"/usr/local/bin/claude","source":"brew"}'
    );
  });

  it("degrades to name-only when path or source missing (no em dash)", () => {
    const body = formatUninstallConfirmBody(t, {
      name: "Claude Code",
      path: null,
      source: "path",
    });
    expect(body).toBe(
      'settings.agents.action.uninstallConfirmBodyNameOnly:{"name":"Claude Code"}'
    );
    expect(body).not.toContain("—");
  });
});
