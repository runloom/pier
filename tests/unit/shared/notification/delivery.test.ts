import {
  DEFAULT_DELIVERY_AGENT_ATTENTION,
  type DeliveryAgentAttentionPrefs,
  type DeliveryFocus,
  type DeliveryInput,
  type DeliveryPrefs,
  makeOsCooldownKey,
  OS_ELIGIBLE_KINDS,
  resolveDeliveryPlan,
  resolveToastTarget,
  routeDelivery,
} from "@shared/notification-delivery.ts";
import { describe, expect, it } from "vitest";

const FOCUSED: DeliveryFocus = { hasFocusedPierWindow: true };
const UNFOCUSED: DeliveryFocus = { hasFocusedPierWindow: false };

function prefs(
  overrides: Omit<Partial<DeliveryPrefs>, "agentAttention"> & {
    agentAttention?: Partial<DeliveryAgentAttentionPrefs>;
  } = {}
): DeliveryPrefs {
  const { agentAttention, ...rest } = overrides;
  return {
    agentAttention: {
      ...DEFAULT_DELIVERY_AGENT_ATTENTION,
      ...agentAttention,
    },
    dndEnabled: false,
    mutedKinds: [],
    ...rest,
  };
}

function plan(
  input: DeliveryInput,
  focus: DeliveryFocus = FOCUSED,
  p: DeliveryPrefs = prefs()
) {
  return resolveDeliveryPlan(input, p, focus);
}

describe("OS_ELIGIBLE_KINDS (v1 freeze)", () => {
  it("only agent attention + turn-finished", () => {
    expect([...OS_ELIGIBLE_KINDS].sort()).toEqual([
      "agent.attention",
      "agent.turn-finished",
    ]);
  });
});

describe("resolveDeliveryPlan · mutual exclusion & focus routing", () => {
  it("never sets toast and osNotify together", () => {
    const cases: Array<{ input: DeliveryInput; focus: DeliveryFocus }> = [
      {
        focus: FOCUSED,
        input: {
          agentRef: "11:p1",
          kind: "agent.attention",
          severity: "warning",
        },
      },
      {
        focus: UNFOCUSED,
        input: {
          agentRef: "11:p1",
          kind: "agent.attention",
          severity: "warning",
        },
      },
      {
        focus: FOCUSED,
        input: { kind: "task-run.finished", severity: "success" },
      },
      {
        focus: UNFOCUSED,
        input: { kind: "task-run.finished", severity: "success" },
      },
    ];
    for (const c of cases) {
      const d = plan(c.input, c.focus).decision;
      expect(d.toast && d.osNotify, JSON.stringify(c)).toBe(false);
      expect(d.inbox).toBe(true);
    }
  });

  it("focused + non-OS kind → toast only", () => {
    const result = plan({
      kind: "task-run.finished",
      severity: "success",
    });
    expect(result.decision).toEqual({
      inbox: true,
      osNotify: false,
      toast: true,
    });
    expect(result.toastTarget).toEqual({ mode: "key-window" });
    expect(result.osTarget).toEqual({ mode: "none" });
    expect(result.osCooldownKey).toBeUndefined();
  });

  it("unfocused + non-OS kind → inbox only (no OS, no toast)", () => {
    const result = plan(
      { kind: "task-run.finished", severity: "success" },
      UNFOCUSED
    );
    expect(result.decision).toEqual({
      inbox: true,
      osNotify: false,
      toast: false,
    });
    expect(result.toastTarget).toEqual({ mode: "none" });
    expect(result.osTarget).toEqual({ mode: "none" });
  });

  it("focused + agent.attention → toast only, no OS", () => {
    const result = plan({
      agentRef: "11:p1",
      kind: "agent.attention",
      panelId: "p1",
      severity: "warning",
    });
    expect(result.decision).toEqual({
      inbox: true,
      osNotify: false,
      toast: true,
    });
    expect(result.osTarget).toEqual({ mode: "none" });
  });

  it("unfocused + agent.attention → OS only with cooldown key", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.attention",
        panelId: "p1",
        severity: "warning",
      },
      UNFOCUSED
    );
    expect(result.decision).toEqual({
      inbox: true,
      osNotify: true,
      toast: false,
    });
    expect(result.toastTarget).toEqual({ mode: "none" });
    expect(result.osTarget).toEqual({ mode: "process" });
    expect(result.osCooldownKey).toBe("agent.attention:waiting:11:p1");
  });

  it("unfocused + app.update → no OS (not in whitelist)", () => {
    const result = plan({ kind: "app.update", severity: "info" }, UNFOCUSED);
    expect(result.decision.osNotify).toBe(false);
    expect(result.decision.toast).toBe(false);
  });
});

describe("resolveDeliveryPlan · mute / DND / suppressToast", () => {
  it("suppressToast silences toast and OS", () => {
    const focused = plan({
      kind: "agent.attention",
      severity: "warning",
      suppressToast: true,
      agentRef: "a",
    });
    const unfocused = plan(
      {
        kind: "agent.attention",
        severity: "warning",
        suppressToast: true,
        agentRef: "a",
      },
      UNFOCUSED
    );
    expect(focused.decision).toEqual({
      inbox: true,
      osNotify: false,
      toast: false,
    });
    expect(unfocused.decision).toEqual({
      inbox: true,
      osNotify: false,
      toast: false,
    });
  });

  it("mutedKinds silences toast and OS, keeps inbox", () => {
    const p = prefs({ mutedKinds: ["agent.attention"] });
    const result = plan(
      {
        agentRef: "a",
        kind: "agent.attention",
        severity: "warning",
      },
      UNFOCUSED,
      p
    );
    expect(result.decision).toEqual({
      inbox: true,
      osNotify: false,
      toast: false,
    });
  });

  it("DND silences non-error toast but not unfocused OS", () => {
    const p = prefs({ dndEnabled: true });
    const focusedInfo = plan(
      { kind: "app.update", severity: "info" },
      FOCUSED,
      p
    );
    expect(focusedInfo.decision.toast).toBe(false);

    const focusedError = plan(
      { kind: "agent.runtime", severity: "error" },
      FOCUSED,
      p
    );
    expect(focusedError.decision.toast).toBe(true);

    const unfocusedAgent = plan(
      {
        agentRef: "11:p1",
        kind: "agent.attention",
        severity: "warning",
      },
      UNFOCUSED,
      p
    );
    // DND v1 不挡 OS
    expect(unfocusedAgent.decision).toEqual({
      inbox: true,
      osNotify: true,
      toast: false,
    });
  });
});

describe("resolveDeliveryPlan · agent fine-grained silence", () => {
  it("suppressWhenFocused + panel focused → no toast/OS, inbox kept", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.attention",
        panelId: "p1",
        severity: "warning",
      },
      { hasFocusedPierWindow: true, isTargetPanelFocused: true },
      prefs({ agentAttention: { suppressWhenFocused: true } })
    );
    expect(result.decision).toEqual({
      inbox: true,
      osNotify: false,
      toast: false,
    });
  });

  it("suppressWhenFocused false → toast even if panel focused", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.attention",
        severity: "warning",
      },
      { hasFocusedPierWindow: true, isTargetPanelFocused: true },
      prefs({ agentAttention: { suppressWhenFocused: false } })
    );
    expect(result.decision.toast).toBe(true);
  });

  it("enabled=false silences agent.attention waiting interrupt", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.attention",
        severity: "warning",
      },
      UNFOCUSED,
      prefs({ agentAttention: { enabled: false } })
    );
    expect(result.decision.toast).toBe(false);
    expect(result.decision.osNotify).toBe(false);
  });

  it("enableErrorAttention=false silences error attention interrupt", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.attention",
        severity: "error",
      },
      UNFOCUSED,
      prefs({ agentAttention: { enableErrorAttention: false } })
    );
    expect(result.decision.osNotify).toBe(false);
  });

  it("enableErrorAttention=true allows unfocused OS for error", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.attention",
        severity: "error",
      },
      UNFOCUSED,
      prefs({ agentAttention: { enableErrorAttention: true } })
    );
    expect(result.decision.osNotify).toBe(true);
    expect(result.osCooldownKey).toBe("agent.attention:error:11:p1");
  });

  it("turnNotifyMode=off silences turn-finished", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.turn-finished",
        severity: "info",
      },
      UNFOCUSED,
      prefs({ agentAttention: { turnNotifyMode: "off" } })
    );
    expect(result.decision.osNotify).toBe(false);
    expect(result.decision.toast).toBe(false);
  });

  it("turnNotifyMode=unfocused + owner focused → silence interrupt", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.turn-finished",
        severity: "info",
      },
      {
        hasFocusedPierWindow: true,
        isOwnerWindowFocused: true,
      },
      prefs({ agentAttention: { turnNotifyMode: "unfocused" } })
    );
    expect(result.decision.toast).toBe(false);
    expect(result.decision.osNotify).toBe(false);
  });

  it("turnNotifyMode=always + owner focused → toast when key present", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.turn-finished",
        severity: "info",
      },
      {
        hasFocusedPierWindow: true,
        isOwnerWindowFocused: true,
      },
      prefs({ agentAttention: { turnNotifyMode: "always" } })
    );
    expect(result.decision.toast).toBe(true);
    expect(result.decision.osNotify).toBe(false);
  });

  it("turnNotifyMode=unfocused + no key → OS", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.turn-finished",
        severity: "info",
      },
      UNFOCUSED,
      prefs({ agentAttention: { turnNotifyMode: "unfocused" } })
    );
    expect(result.decision).toEqual({
      inbox: true,
      osNotify: true,
      toast: false,
    });
    expect(result.osCooldownKey).toBe("agent.turn-finished:11:p1");
  });
});

describe("resolveDeliveryPlan · toast targets", () => {
  it("task-run with origin → origin-window", () => {
    const result = plan({
      kind: "task-run.finished",
      originWindowId: "42",
      severity: "success",
    });
    expect(result.toastTarget).toEqual({
      mode: "origin-window",
      originWindowId: "42",
    });
  });

  it("agent attention never uses origin even if originWindowId set", () => {
    const result = plan({
      kind: "agent.attention",
      originWindowId: "9",
      severity: "warning",
      agentRef: "a",
    });
    expect(result.toastTarget).toEqual({ mode: "key-window" });
  });
});

describe("makeOsCooldownKey", () => {
  it("splits attention waiting vs error", () => {
    expect(makeOsCooldownKey("agent.attention", "warning", "11:p1")).toBe(
      "agent.attention:waiting:11:p1"
    );
    expect(makeOsCooldownKey("agent.attention", "error", "11:p1")).toBe(
      "agent.attention:error:11:p1"
    );
  });
});

describe("routeDelivery / resolveToastTarget compatibility (focused default)", () => {
  const UNMUTED = { dndEnabled: false, mutedKinds: [] as const };

  it("defaults: toast + inbox, no os (assumes focused)", () => {
    expect(
      routeDelivery({ kind: "task-run.finished", severity: "success" }, UNMUTED)
    ).toEqual({ inbox: true, osNotify: false, toast: true });
  });

  it("suppressToast wins", () => {
    expect(
      routeDelivery(
        { kind: "app.update", severity: "warning", suppressToast: true },
        UNMUTED
      ).toast
    ).toBe(false);
  });

  it("mutedKinds silence toast but keep inbox", () => {
    const decision = routeDelivery(
      { kind: "app.update", severity: "info" },
      { dndEnabled: false, mutedKinds: ["app.update"] }
    );
    expect(decision).toEqual({ inbox: true, osNotify: false, toast: false });
  });

  it("DND silences non-error toast; error always toasts when focused", () => {
    const dnd = { dndEnabled: true, mutedKinds: [] as const };
    expect(
      routeDelivery({ kind: "app.update", severity: "info" }, dnd).toast
    ).toBe(false);
    expect(
      routeDelivery({ kind: "app.update", severity: "warning" }, dnd).toast
    ).toBe(false);
    expect(
      routeDelivery({ kind: "agent.runtime", severity: "error" }, dnd).toast
    ).toBe(true);
  });

  it("resolveToastTarget none when toast blocked", () => {
    expect(
      resolveToastTarget(
        { kind: "app.update", severity: "info", suppressToast: true },
        UNMUTED
      )
    ).toEqual({ mode: "none" });
  });

  it("resolveToastTarget origin for task-run", () => {
    expect(
      resolveToastTarget(
        {
          kind: "task-run.finished",
          severity: "success",
          originWindowId: "42",
        },
        UNMUTED
      )
    ).toEqual({ mode: "origin-window", originWindowId: "42" });
  });

  it("resolveToastTarget key-window without origin", () => {
    expect(
      resolveToastTarget(
        { kind: "task-run.finished", severity: "success" },
        UNMUTED
      )
    ).toEqual({ mode: "key-window" });
  });

  it("resolveToastTarget key-window for agent attention", () => {
    expect(
      resolveToastTarget(
        { kind: "agent.attention", severity: "warning", originWindowId: "9" },
        UNMUTED
      )
    ).toEqual({ mode: "key-window" });
  });
});
