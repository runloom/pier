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
  it("attention + panel focused → no toast/OS, inbox kept (product fixed)", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.attention",
        panelId: "p1",
        severity: "warning",
      },
      { hasFocusedPierWindow: true, isTargetPanelFocused: true }
    );
    expect(result.decision).toEqual({
      inbox: true,
      osNotify: false,
      toast: false,
    });
  });

  it("attention + same window other panel → toast", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.attention",
        severity: "warning",
      },
      {
        hasFocusedPierWindow: true,
        isOwnerWindowFocused: true,
        isTargetPanelFocused: false,
      }
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

  it("turnNotifyMode=unfocused + same window other panel → still silence", () => {
    // 窗口级：同窗异面板也不提醒完成。
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.turn-finished",
        severity: "info",
      },
      {
        hasFocusedPierWindow: true,
        isOwnerWindowFocused: true,
        isTargetPanelFocused: false,
      },
      prefs({ agentAttention: { turnNotifyMode: "unfocused" } })
    );
    expect(result.decision.toast).toBe(false);
    expect(result.decision.osNotify).toBe(false);
  });

  it("turnNotifyMode=panel-unfocused + panel focused → silence", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.turn-finished",
        severity: "info",
      },
      {
        hasFocusedPierWindow: true,
        isOwnerWindowFocused: true,
        isTargetPanelFocused: true,
      },
      prefs({ agentAttention: { turnNotifyMode: "panel-unfocused" } })
    );
    expect(result.decision.toast).toBe(false);
    expect(result.decision.osNotify).toBe(false);
  });

  it("turnNotifyMode=panel-unfocused + same window other panel → toast", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.turn-finished",
        severity: "info",
      },
      {
        hasFocusedPierWindow: true,
        isOwnerWindowFocused: true,
        isTargetPanelFocused: false,
      },
      prefs({ agentAttention: { turnNotifyMode: "panel-unfocused" } })
    );
    expect(result.decision.toast).toBe(true);
    expect(result.decision.osNotify).toBe(false);
  });

  it("turnNotifyMode=panel-unfocused + no key → OS", () => {
    const result = plan(
      {
        agentRef: "11:p1",
        kind: "agent.turn-finished",
        severity: "info",
      },
      {
        hasFocusedPierWindow: false,
        isOwnerWindowFocused: false,
        isTargetPanelFocused: false,
      },
      prefs({ agentAttention: { turnNotifyMode: "panel-unfocused" } })
    );
    expect(result.decision).toEqual({
      inbox: true,
      osNotify: true,
      toast: false,
    });
    expect(result.osCooldownKey).toBe("agent.turn-finished:11:p1");
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

describe("resolveDeliveryPlan · remotePush 第三正交通道（M2 规格 §12）", () => {
  const CANDIDATES = [
    { deviceId: "d-idle", hasLiveSession: false },
    { deviceId: "d-live", hasLiveSession: true },
  ];
  const attention: DeliveryInput = {
    agentRef: "11:p1",
    kind: "agent.attention",
    severity: "warning",
  };

  it("有 key-window 仍推手机（与 toast 并行；toast/OS 互斥不受影响）", () => {
    const result = resolveDeliveryPlan(attention, prefs(), FOCUSED, {
      candidates: CANDIDATES,
    });
    expect(result.decision.toast).toBe(true);
    expect(result.decision.osNotify).toBe(false);
    expect(result.remotePushTarget).toEqual({
      deviceIds: ["d-idle"],
      mode: "devices",
    });
  });

  it("有前台会话的设备被剔除；候选全在线 → none", () => {
    const result = resolveDeliveryPlan(attention, prefs(), UNFOCUSED, {
      candidates: [{ deviceId: "d-live", hasLiveSession: true }],
    });
    expect(result.remotePushTarget).toEqual({ mode: "none" });
  });

  it("kind ∉ OS 白名单 → none（与 OS 同门）", () => {
    const result = resolveDeliveryPlan(
      { kind: "task-run.finished", severity: "info" },
      prefs(),
      UNFOCUSED,
      { candidates: CANDIDATES }
    );
    expect(result.remotePushTarget).toEqual({ mode: "none" });
  });

  it("DND 挡非 error、放行 error（与 toast 同规则；不改 OS 既有行为）", () => {
    const blocked = resolveDeliveryPlan(
      attention,
      prefs({ dndEnabled: true }),
      UNFOCUSED,
      { candidates: CANDIDATES }
    );
    expect(blocked.remotePushTarget).toEqual({ mode: "none" });
    expect(blocked.decision.osNotify).toBe(true);

    const error = resolveDeliveryPlan(
      { ...attention, severity: "error" },
      prefs({
        agentAttention: { enableErrorAttention: true },
        dndEnabled: true,
      }),
      UNFOCUSED,
      { candidates: CANDIDATES }
    );
    expect(error.remotePushTarget).toEqual({
      deviceIds: ["d-idle"],
      mode: "devices",
    });
  });

  it("agent 细粒度静音 → remotePush 同静音（打断三通道统一受门）", () => {
    const result = resolveDeliveryPlan(
      attention,
      prefs({ agentAttention: { enabled: false } }),
      UNFOCUSED,
      { candidates: CANDIDATES }
    );
    expect(result.remotePushTarget).toEqual({ mode: "none" });
  });

  it("mutedKinds / suppressToast → remotePush 同静音（只落档不打扰）", () => {
    const muted = resolveDeliveryPlan(
      attention,
      prefs({ mutedKinds: ["agent.attention"] }),
      UNFOCUSED,
      { candidates: CANDIDATES }
    );
    expect(muted.remotePushTarget).toEqual({ mode: "none" });

    const suppressed = resolveDeliveryPlan(
      { ...attention, suppressToast: true },
      prefs(),
      UNFOCUSED,
      { candidates: CANDIDATES }
    );
    expect(suppressed.remotePushTarget).toEqual({ mode: "none" });
  });

  it("缺省第四入参 = 无候选 → none（既有调用零改动回归）", () => {
    expect(plan(attention).remotePushTarget).toEqual({ mode: "none" });
  });
});
