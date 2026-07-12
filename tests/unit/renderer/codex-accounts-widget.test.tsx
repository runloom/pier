import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExternalRendererPluginContext,
  MissionControlWidgetComponentProps,
} from "../../../packages/plugin-api/src/renderer.ts";
import { AccountsWidget } from "../../../packages/plugin-codex/src/renderer/accounts-widget.tsx";
import { CostWidget } from "../../../packages/plugin-codex/src/renderer/cost-widget.tsx";
import { plugin } from "../../../packages/plugin-codex/src/renderer/index.tsx";
import { sortUsageWindows } from "../../../packages/plugin-codex/src/renderer/usage-meter.tsx";
import type { CodexAccountsSnapshot } from "../../../packages/plugin-codex/src/shared/accounts.ts";

function baseProps(
  overrides: Partial<MissionControlWidgetComponentProps> = {}
): MissionControlWidgetComponentProps {
  return {
    instanceId: "widget-1",
    params: {},
    refreshToken: 0,
    size: { w: 4, h: 6 },
    updateParams: vi.fn(),
    visible: true,
    ...overrides,
  };
}

function usageSnapshot(
  overrides: Partial<CodexAccountsSnapshot> = {}
): CodexAccountsSnapshot {
  return {
    accounts: [
      { id: "acc-1", label: "test@codex.dev", status: "active", error: null },
    ],
    activeAccountId: "acc-1",
    activeUsage: {
      fetchedAt: Date.now(),
      status: "ok",
      windows: [
        {
          id: "codex:primary",
          limitId: "codex",
          resetsAt: Date.now() + 3_600_000,
          usedPercent: 32,
          windowMinutes: 300,
        },
        {
          id: "codex:secondary",
          limitId: "codex",
          resetsAt: Date.now() + 86_400_000,
          usedPercent: 68,
          windowMinutes: 10_080,
        },
      ],
    },
    login: null,
    revision: 1,
    schemaVersion: 1,
    ...overrides,
  };
}

function noActiveAccountSnapshot(): CodexAccountsSnapshot {
  return {
    accounts: [],
    activeAccountId: null,
    activeUsage: {
      fetchedAt: Date.now(),
      status: "ok",
      windows: [
        {
          id: "codex:primary",
          limitId: "codex",
          resetsAt: Date.now() + 3_600_000,
          usedPercent: 10,
          windowMinutes: 300,
        },
        {
          id: "codex:secondary",
          limitId: "codex",
          usedPercent: 45,
          windowMinutes: 10_080,
        },
      ],
    },
    login: null,
    revision: 1,
    schemaVersion: 1,
  };
}

function contextWithSnapshot(snapshot: CodexAccountsSnapshot): {
  context: ExternalRendererPluginContext;
  invokeCalls: Array<{ method: string; payload: unknown }>;
} {
  const invokeCalls: Array<{ method: string; payload: unknown }> = [];
  const invoke: ExternalRendererPluginContext["rpc"]["invoke"] = async <T,>(
    method: string,
    payload?: unknown
  ): Promise<T> => {
    invokeCalls.push({ method, payload });
    return (method === "accounts.snapshot" ? snapshot : null) as T;
  };
  return {
    context: {
      app: { openSettings: vi.fn() },
      actions: { register: vi.fn(() => () => undefined) },
      configuration: {
        get: vi.fn(
          () => false
        ) as ExternalRendererPluginContext["configuration"]["get"],
        onDidChange: vi.fn(() => () => undefined),
        reset: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
      },
      missionControlWidgets: { register: vi.fn(() => () => undefined) },
      dialogs: { alert: vi.fn(), confirm: vi.fn(async () => true) },
      i18n: {
        language: () => "en",
        t: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
      },
      lifecycle: { beforeSuspend: vi.fn(() => () => undefined) },
      notifications: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
      panels: { register: vi.fn(() => () => undefined) },
      rpc: { invoke, on: vi.fn(() => () => undefined) },
      settingsPages: { register: vi.fn(() => () => undefined) },
    },
    invokeCalls,
  };
}

/** Radix DropdownMenu triggers need pointerDown, not click. */
function openDropdown(triggerName: string): void {
  const btn = screen.getByRole("button", { name: triggerName });
  fireEvent.pointerDown(btn, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
}

describe("AccountsWidget (usage)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders remaining percent for dynamic usage windows", async () => {
    const snap = usageSnapshot();
    const { context } = contextWithSnapshot(snap);
    const { container } = render(
      <AccountsWidget context={context} {...baseProps()} />
    );

    await screen.findByText("5-hour quota");
    expect(screen.getByText("7-day quota")).toBeDefined();
    expect(container.textContent).toContain("32%");
    expect(container.textContent).toContain("68%");
    expect(container.textContent).not.toContain("remaining");
  });

  it("calls accounts.select when managed account is selected", async () => {
    const snap = usageSnapshot({
      accounts: [
        {
          id: "acc-1",
          label: "active@codex.dev",
          status: "active",
          error: null,
        },
        {
          id: "acc-2",
          label: "other@codex.dev",
          status: "available",
          error: null,
        },
      ],
      activeAccountId: "acc-1",
    });
    const { context, invokeCalls } = contextWithSnapshot(snap);
    render(<AccountsWidget context={context} {...baseProps()} />);

    await screen.findByText("active@codex.dev");
    openDropdown("Switch account");

    const otherOption = await screen.findByText("other@codex.dev");
    await act(async () => {
      fireEvent.click(otherOption);
    });

    expect(context.dialogs.confirm).toHaveBeenCalledWith({
      body: "New Codex sessions will use this account. Restart any Codex sessions that are already running for the change to take effect.",
      intent: "default",
      title: "Switch Codex account?",
    });
    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "accounts.select",
        payload: { accountId: "acc-2" },
      });
    });
  });

  it('calls app.openSettings when "Manage accounts..." is clicked', async () => {
    const snap = usageSnapshot();
    const { context } = contextWithSnapshot(snap);
    render(<AccountsWidget context={context} {...baseProps()} />);

    await screen.findByText("test@codex.dev");
    openDropdown("Switch account");

    const manageBtn = await screen.findByText("Manage accounts...");
    fireEvent.click(manageBtn);

    expect(context.app.openSettings).toHaveBeenCalledWith({
      section: "plugin:pier.codex",
    });
  });

  it("calls accounts.refreshUsage when refreshToken changes", async () => {
    const snap = usageSnapshot();
    const { context, invokeCalls } = contextWithSnapshot(snap);
    const { rerender } = render(
      <AccountsWidget context={context} {...baseProps({ refreshToken: 0 })} />
    );

    await screen.findByText("5-hour quota");

    await act(async () => {
      rerender(
        <AccountsWidget context={context} {...baseProps({ refreshToken: 1 })} />
      );
    });

    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "accounts.refreshUsage",
        payload: null,
      });
    });
  });

  it("renders an explicit fallback when no account is active", async () => {
    const snap = noActiveAccountSnapshot();
    const { context } = contextWithSnapshot(snap);
    render(<AccountsWidget context={context} {...baseProps()} />);

    expect(await screen.findByText("No active account")).toBeDefined();
  });

  it("uses container-query layouts for narrow and wider widget spaces", async () => {
    const { context } = contextWithSnapshot(usageSnapshot());
    const { container } = render(
      <AccountsWidget
        context={context}
        {...baseProps({ size: { w: 2, h: 3 } })}
      />
    );

    await screen.findByText("5-hour quota");
    const meter = container.querySelector('[data-slot="codex-usage-meter"]');
    const progressBars = container.querySelectorAll(
      '[data-slot="codex-usage-progress"] [data-slot="progress"]'
    );
    const primaryWindows = container.querySelectorAll(
      '[data-window-group="primary"] [data-slot="codex-usage-progress"]'
    );
    expect(meter?.className).toContain("pier-codex-usage-meter");
    expect(progressBars).toHaveLength(2);
    expect(primaryWindows).toHaveLength(2);
    expect(primaryWindows[1]?.className).not.toContain("codex:hidden");
    expect(
      container.querySelector('[data-window-group="primary"]')?.className
    ).toContain("codex:@[22rem]:grid-cols-2");
    expect(
      container.querySelector('[data-window-group="primary"]')?.className
    ).toContain("codex:grid-cols-1");
    expect(progressBars[0]?.className).toContain("h-1");
    expect(progressBars[0]?.getAttribute("data-variant")).toBe("success");
  });

  it("keeps primary quota windows before model-specific windows", () => {
    const ordered = sortUsageWindows([
      {
        id: "codex:secondary",
        limitId: "codex",
        usedPercent: 10,
        windowMinutes: 10_080,
      },
      {
        id: "spark:primary",
        limitId: "spark",
        limitName: "GPT-5.3-Codex-Spark",
        usedPercent: 0,
        windowMinutes: 300,
      },
      {
        id: "codex:primary",
        limitId: "codex",
        usedPercent: 20,
        windowMinutes: 300,
      },
    ]);

    expect(ordered.map((window) => window.id)).toEqual([
      "codex:primary",
      "codex:secondary",
      "spark:primary",
    ]);
  });

  it("registers account/quota and cost as independent widgets", () => {
    const { context } = contextWithSnapshot(usageSnapshot());
    const register = vi.mocked(context.missionControlWidgets.register);
    const dispose = plugin.activate(context);

    expect(register).toHaveBeenCalledTimes(2);
    expect(register.mock.calls.map(([entry]) => entry.id)).toEqual([
      "pier.codex.accounts",
      "pier.codex.cost",
    ]);

    dispose();
  });

  it("deduplicates the shared snapshot request across both widgets", async () => {
    const { context, invokeCalls } = contextWithSnapshot(usageSnapshot());
    render(
      <>
        <AccountsWidget context={context} {...baseProps()} />
        <CostWidget
          context={context}
          {...baseProps({ instanceId: "widget-2" })}
        />
      </>
    );

    await screen.findByText("5-hour quota");
    expect(
      invokeCalls.filter((call) => call.method === "accounts.snapshot")
    ).toHaveLength(1);
  });

  it("mounts and removes the plugin-owned responsive stylesheet", () => {
    const { context } = contextWithSnapshot(usageSnapshot());
    const dispose = plugin.activate(context);
    const style = document.head.querySelector(
      'style[data-plugin-id="pier.codex"]'
    );

    expect(style).not.toBeNull();

    dispose();
    expect(
      document.head.querySelector('style[data-plugin-id="pier.codex"]')
    ).toBeNull();
  });

  it("does not refresh while the widget is hidden", async () => {
    const { context, invokeCalls } = contextWithSnapshot(usageSnapshot());
    const { rerender } = render(
      <AccountsWidget
        context={context}
        {...baseProps({ refreshToken: 0, visible: false })}
      />
    );

    await screen.findByText("5-hour quota");
    rerender(
      <AccountsWidget
        context={context}
        {...baseProps({ refreshToken: 1, visible: false })}
      />
    );

    await Promise.resolve();
    expect(
      invokeCalls.some((call) => call.method === "accounts.refreshUsage")
    ).toBe(false);
  });
});

describe("CostWidget", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders responsive cost metrics and local history", async () => {
    const snapshot = usageSnapshot({
      costUsage: {
        buckets: [
          {
            date: "2026-07-12",
            estimatedCostMicrousd: 350_000,
            pricingStatus: "complete",
            tokens: {
              cachedInputTokens: 0,
              inputTokens: 100,
              outputTokens: 50,
              reasoningTokens: 25,
              totalTokens: 175,
            },
          },
        ],
        coverage: { complete: true, from: "2026-06-12", to: "2026-07-12" },
        observedAt: Date.now(),
        summary: {
          estimatedCostMicrousd: 2_991_180_000,
          latestDayTokens: 9_900_000_000,
          periodTokens: 64_700_000_000,
          todayEstimatedCostMicrousd: 350_000,
        },
      },
    });
    const { context } = contextWithSnapshot(snapshot);
    const { container } = render(
      <CostWidget context={context} {...baseProps({ size: { w: 2, h: 3 } })} />
    );

    expect(await screen.findByText("Today")).toBeDefined();
    expect(screen.getByText("Last 31 days cost")).toBeDefined();
    expect(container.querySelectorAll(".pier-codex-cost-bars")).toHaveLength(2);
    expect(
      container.querySelector('[data-cost-metric="period-cost"]')?.className
    ).toContain("@[22rem]:block");
  });

  it("refreshes cost independently and reports success", async () => {
    const { context, invokeCalls } = contextWithSnapshot(
      usageSnapshot({
        costUsage: {
          buckets: [],
          coverage: { complete: true, from: "2026-06-12", to: "2026-07-12" },
          observedAt: Date.now(),
          summary: {
            estimatedCostMicrousd: 0,
            latestDayTokens: 0,
            periodTokens: 0,
            todayEstimatedCostMicrousd: 0,
          },
        },
      })
    );
    const { rerender } = render(
      <CostWidget context={context} {...baseProps({ refreshToken: 0 })} />
    );
    await screen.findByText("Today");

    await act(async () => {
      rerender(
        <CostWidget context={context} {...baseProps({ refreshToken: 1 })} />
      );
    });

    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "usage.refreshCost",
        payload: null,
      });
      expect(context.notifications.success).toHaveBeenCalledWith(
        "Cost data refreshed"
      );
    });
  });
});
