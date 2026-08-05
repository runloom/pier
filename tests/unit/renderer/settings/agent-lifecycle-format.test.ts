import { describe, expect, it } from "vitest";
import {
  formatAgentVersionMeta,
  formatLifecycleRowFailure,
  lifecycleBusyStatusText,
  resolveAgentStatusBadge,
} from "../../../../src/renderer/pages/settings/components/agent-lifecycle-format.ts";

const t = ((key: string, opts?: Record<string, unknown>) => {
  if (!opts) {
    return key;
  }
  return `${key}:${JSON.stringify(opts)}`;
}) as never;

describe("formatAgentVersionMeta", () => {
  it("uses arrow when current and latest differ", () => {
    expect(formatAgentVersionMeta("2.1.221", "2.1.222")).toBe(
      "2.1.221 → 2.1.222"
    );
  });

  it("shows a single version when already latest", () => {
    expect(formatAgentVersionMeta("0.146.0", "0.146.0")).toBe("0.146.0");
  });

  it("falls back to whichever side is present", () => {
    expect(formatAgentVersionMeta("1.0.0", null)).toBe("1.0.0");
    expect(formatAgentVersionMeta(null, "0.86.2")).toBe("0.86.2");
    expect(formatAgentVersionMeta(null, null)).toBeNull();
  });
});

describe("resolveAgentStatusBadge", () => {
  it("prioritizes broken over conflict and update-like states", () => {
    const badge = resolveAgentStatusBadge(t, {
      broken: true,
      conflict: true,
      disabled: true,
      detected: true,
    });
    expect(badge?.label).toBe("settings.agents.status.broken");
  });

  it("returns null for a healthy installed agent", () => {
    expect(
      resolveAgentStatusBadge(t, {
        broken: false,
        conflict: false,
        disabled: false,
        detected: true,
      })
    ).toBeNull();
  });

  it("shows missing when not detected", () => {
    const badge = resolveAgentStatusBadge(t, {
      broken: false,
      conflict: false,
      disabled: false,
      detected: false,
    });
    expect(badge?.label).toBe("settings.agents.status.missing");
  });

  it("prefers missing over stale disabled for uninstalled agents", () => {
    const badge = resolveAgentStatusBadge(t, {
      broken: false,
      conflict: false,
      disabled: true,
      detected: false,
    });
    expect(badge?.label).toBe("settings.agents.status.missing");
  });
});

describe("lifecycleBusyStatusText", () => {
  it("shows queue state without inventing percent", () => {
    expect(
      lifecycleBusyStatusText(t, {
        action: "update",
        queued: true,
        progress: undefined,
      })
    ).toBe("settings.agents.action.queueBusy");
  });

  it("does not surface package-manager names", () => {
    const text = lifecycleBusyStatusText(t, {
      action: "update",
      progress: {
        action: "update",
        agentId: "gemini",
        label: "npm",
        stepCount: 1,
        stepIndex: 0,
      },
    });
    expect(text).toBe("settings.agents.action.updateBusy");
    expect(text).not.toContain("npm");
  });

  it("shows step index only for multi-step plans", () => {
    const text = lifecycleBusyStatusText(t, {
      action: "install",
      progress: {
        action: "install",
        agentId: "claude",
        label: "npm",
        stepCount: 2,
        stepIndex: 1,
      },
    });
    expect(text).toContain("settings.agents.action.installBusy");
    expect(text).toContain("busyStep");
    expect(text).toContain('"current":2');
    expect(text).toContain('"total":2');
  });

  it("appends percent only when tool reported it", () => {
    const withPct = lifecycleBusyStatusText(t, {
      action: "install",
      progress: {
        action: "install",
        agentId: "aider",
        label: "uv",
        stepCount: 1,
        stepIndex: 0,
        percent: 42.4,
      },
    });
    expect(withPct).toContain("42");
    const noPct = lifecycleBusyStatusText(t, {
      action: "install",
      progress: {
        action: "install",
        agentId: "aider",
        label: "uv",
        stepCount: 1,
        stepIndex: 0,
      },
    });
    expect(noPct).not.toContain("percent");
  });
});

describe("formatLifecycleRowFailure", () => {
  it("formats short red-line failure without repeating agent name", () => {
    expect(
      formatLifecycleRowFailure(t, {
        name: "OMP",
        failure: { action: "update" },
      })
    ).toBe("settings.agents.action.rowUpdateFailed");
  });
});
