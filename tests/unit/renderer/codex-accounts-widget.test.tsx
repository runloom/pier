import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExternalRendererPluginContext,
  MissionControlWidgetComponentProps,
} from "../../../packages/plugin-api/src/renderer.ts";
import {
  AccountsWidget,
  accountsWidgetActions,
} from "../../../packages/plugin-codex/src/renderer/accounts-widget.tsx";
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

  it("hides the account switcher when no alternative account exists", async () => {
    const { context } = contextWithSnapshot(usageSnapshot());
    render(<AccountsWidget context={context} {...baseProps()} />);

    await screen.findByText("test@codex.dev");
    expect(screen.queryByRole("button", { name: "Switch account" })).toBeNull();
  });

  it("renders a readable menu containing only switchable accounts", async () => {
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
    const { context } = contextWithSnapshot(snap);
    render(<AccountsWidget context={context} {...baseProps()} />);

    await screen.findByText("active@codex.dev");
    openDropdown("Switch account");

    const menu = await screen.findByRole("menu");
    expect(menu.style.minWidth).toBe(
      "min(16rem, var(--radix-dropdown-menu-content-available-width))"
    );
    expect(menu.style.maxWidth).toBe(
      "var(--radix-dropdown-menu-content-available-width)"
    );
    expect(within(menu).queryByText("active@codex.dev")).toBeNull();
    const target = within(menu).getByText("other@codex.dev");
    expect(target.className).toContain("break-words");
    expect(target.className).not.toContain("truncate");
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

    // The switch confirmation dialog opens with sync checkboxes.
    const switchButton = await screen.findByRole("button", { name: /Switch$/ });
    await act(async () => {
      fireEvent.click(switchButton);
    });
    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "accounts.select",
        payload: {
          accountId: "acc-2",
          syncTargets: ["opencode", "pi", "omp"],
        },
      });
    });
  });

  it("shows only the spinner icon while an account switch is pending", async () => {
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
    const { context } = contextWithSnapshot(snap);
    const invoke = context.rpc.invoke;
    let resolveSelect: (() => void) | undefined;
    context.rpc.invoke = async <T,>(
      method: string,
      payload?: unknown
    ): Promise<T> => {
      if (method === "accounts.select") {
        await new Promise<void>((resolve) => {
          resolveSelect = resolve;
        });
        return null as T;
      }
      return invoke<T>(method, payload);
    };
    render(<AccountsWidget context={context} {...baseProps()} />);

    await screen.findByText("active@codex.dev");
    openDropdown("Switch account");
    fireEvent.click(await screen.findByText("other@codex.dev"));

    // Confirm in the switch dialog to trigger the RPC.
    const switchButton = await screen.findByRole("button", { name: /Switch$/ });
    await act(async () => {
      fireEvent.click(switchButton);
    });

    await screen.findByRole("status", { name: "Switching account" });
    const trigger = screen.getByRole("button", { name: "Switch account" });
    expect(trigger.querySelectorAll("svg")).toHaveLength(1);

    await act(async () => {
      resolveSelect?.();
    });
  });

  it('calls app.openSettings when "Manage accounts..." is clicked', async () => {
    const snap = usageSnapshot({
      accounts: [
        {
          id: "acc-1",
          label: "test@codex.dev",
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

  it("exposes a refresh action that awaits accounts.refreshUsage", async () => {
    const snap = usageSnapshot();
    const { context, invokeCalls } = contextWithSnapshot(snap);
    const [action] = accountsWidgetActions(context, {
      instanceId: "widget-1",
      params: {},
      requestRefresh: vi.fn(),
      updateParams: vi.fn(),
    });
    expect(action?.id).toBe("refresh");
    await action?.invoke({
      instanceId: "widget-1",
      params: {},
      requestRefresh: vi.fn(),
      updateParams: vi.fn(),
    });
    expect(invokeCalls).toContainEqual({
      method: "accounts.refreshUsage",
      payload: null,
    });
    expect(context.notifications.success).toHaveBeenCalledTimes(1);
  });

  it("renders an explicit fallback when no account is active", async () => {
    const snap = noActiveAccountSnapshot();
    const { context } = contextWithSnapshot(snap);
    render(<AccountsWidget context={context} {...baseProps()} />);

    expect(await screen.findByText("No active account")).toBeDefined();
  });

  it("keeps every quota visible and identifiable at compact size", async () => {
    const snapshot = usageSnapshot({
      activeUsage: {
        fetchedAt: Date.now(),
        status: "ok",
        windows: [
          {
            id: "codex:secondary",
            limitId: "codex",
            resetsAt: Date.now() + 86_400_000,
            usedPercent: 32,
            windowMinutes: 10_080,
          },
          {
            id: "spark:secondary",
            limitId: "spark",
            limitName: "GPT-5.3-Codex-Spark",
            resetsAt: Date.now() + 86_400_000,
            usedPercent: 0,
            windowMinutes: 10_080,
          },
        ],
      },
    });
    const { context } = contextWithSnapshot(snapshot);
    const { container } = render(
      <AccountsWidget
        context={context}
        {...baseProps({ size: { w: 3, h: 3 } })}
      />
    );

    await screen.findByText("7-day quota");
    expect(screen.getByText("GPT-5.3-Codex-Spark · 7-day quota")).toBeDefined();

    const meter = container.querySelector('[data-slot="codex-usage-meter"]');
    const windows = container.querySelectorAll(
      '[data-slot="codex-usage-progress"]'
    );
    expect(meter?.className).toContain("pier-codex-usage-meter");
    expect(meter?.className).toContain("auto-fit");
    expect(meter?.className).toContain("content-start");
    expect(windows).toHaveLength(2);
    expect(
      Array.from(windows, (window) => window.getAttribute("data-limit-id"))
    ).toEqual(["codex", "spark"]);
    expect(container.querySelector('[data-slot="separator"]')).toBeNull();
    expect(
      container.querySelectorAll(
        '[data-slot="codex-usage-progress"] [data-slot="progress"]'
      )
    ).toHaveLength(2);
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

  it("registers only the account/quota widget (cost owns host core.cost-overview)", () => {
    const { context } = contextWithSnapshot(usageSnapshot());
    const register = vi.mocked(context.missionControlWidgets.register);
    const dispose = plugin.activate(context);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls.map(([entry]) => entry.id)).toEqual([
      "pier.codex.accounts",
    ]);

    dispose();
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

  it("does not render an in-body refresh spinner while an action is in flight", () => {
    // 新契约：refresh 状态归 header 按钮 spinner，widget body 不再自渲另一份
    // 「Refreshing」badge——防两个 loading 指示同时出现的错觉 bug。
    const { context } = contextWithSnapshot(usageSnapshot());
    render(<AccountsWidget context={context} {...baseProps()} />);
    expect(screen.queryByText("Refreshing")).toBeNull();
    expect(
      document.querySelector('[data-slot="spinner"][aria-label="Refreshing"]')
    ).toBeNull();
  });
});
