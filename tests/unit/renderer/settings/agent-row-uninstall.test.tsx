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
  it("managed canUninstall → true", () => {
    expect(
      shouldShowAgentUninstall({
        isBusy: false,
        isDetected: true,
        canUninstall: true,
      })
    ).toBe(true);
  });

  it("not managed (path/script) → false — no button, no explanation", () => {
    expect(
      shouldShowAgentUninstall({
        isBusy: false,
        isDetected: true,
        canUninstall: false,
      })
    ).toBe(false);
  });

  it("busy → false", () => {
    expect(
      shouldShowAgentUninstall({
        isBusy: true,
        isDetected: true,
        canUninstall: true,
      })
    ).toBe(false);
  });

  it("not detected → false", () => {
    expect(
      shouldShowAgentUninstall({
        isBusy: false,
        isDetected: false,
        canUninstall: true,
      })
    ).toBe(false);
  });

  it("canUninstall undefined → false", () => {
    expect(
      shouldShowAgentUninstall({
        isBusy: false,
        isDetected: true,
        canUninstall: undefined,
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

  it("appends conflict note when isConflict (design §9.3)", () => {
    const body = formatUninstallConfirmBody(t, {
      name: "Claude Code",
      path: "/opt/homebrew/bin/claude",
      source: "brew",
      isConflict: true,
    });
    expect(body).toContain("settings.agents.action.uninstallConfirmBody:");
    expect(body).toContain(
      "settings.agents.action.uninstallConfirmConflictNote"
    );
  });

  it("does not append conflict note when isConflict is false", () => {
    const body = formatUninstallConfirmBody(t, {
      name: "Claude Code",
      path: "/opt/homebrew/bin/claude",
      source: "brew",
      isConflict: false,
    });
    expect(body).not.toContain("uninstallConfirmConflictNote");
  });
});
