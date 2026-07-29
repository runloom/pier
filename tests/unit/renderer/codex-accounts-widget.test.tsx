import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppContentDialogHost } from "@/components/common/app-content-dialog-host.tsx";
import {
  closeAppContentDialog,
  openAppContentDialog,
  resetAppContentDialogForTests,
  updateAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import type {
  ExternalRendererPluginContext,
  WorkbenchWidgetComponentProps,
} from "../../../packages/plugin-api/src/renderer.ts";
import {
  AccountsWidget,
  accountsWidgetActions,
} from "../../../packages/plugin-codex/src/renderer/accounts-widget.tsx";
import { plugin } from "../../../packages/plugin-codex/src/renderer/index.tsx";
import type { CodexAccountsSnapshot } from "../../../packages/plugin-codex/src/shared/accounts.ts";

function baseProps(
  overrides: Partial<WorkbenchWidgetComponentProps> = {}
): WorkbenchWidgetComponentProps {
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
      attemptedAt: Date.now(),
      metrics: [
        {
          groupId: "codex",
          id: "codex:primary",
          kind: "quota",
          resetsAt: Date.now() + 3_600_000,
          usedPercent: 32,
          windowMinutes: 300,
        },
        {
          groupId: "codex",
          id: "codex:secondary",
          kind: "quota",
          resetsAt: Date.now() + 86_400_000,
          usedPercent: 68,
          windowMinutes: 10_080,
        },
      ],
      status: "ok",
      updatedAt: Date.now(),
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
      attemptedAt: Date.now(),
      metrics: [
        {
          groupId: "codex",
          id: "codex:primary",
          kind: "quota",
          resetsAt: Date.now() + 3_600_000,
          usedPercent: 10,
          windowMinutes: 300,
        },
        {
          groupId: "codex",
          id: "codex:secondary",
          kind: "quota",
          usedPercent: 45,
          windowMinutes: 10_080,
        },
      ],
      status: "ok",
      updatedAt: Date.now(),
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
    if (method === "accounts.snapshot") {
      return snapshot as T;
    }
    if (method === "accounts.peerAvailability") {
      return {
        omp: true,
        opencode: true,
        pi: true,
        piOauthCapable: true,
      } as T;
    }
    return null as T;
  };
  return {
    context: {
      app: {
        closeSettings: vi.fn(),
        openExternal: vi.fn(async () => true),
        openSettings: vi.fn(),
      },
      actions: { register: vi.fn(() => () => undefined) },
      commandPalette: {
        openQuickPick: vi.fn(),
        updateQuickPick: vi.fn(),
      },
      configuration: {
        get: vi.fn(
          () => false
        ) as ExternalRendererPluginContext["configuration"]["get"],
        onDidChange: vi.fn(() => () => undefined),
        reset: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
      },
      workbenchWidgets: { register: vi.fn(() => () => undefined) },
      dialogs: {
        alert: vi.fn(async () => undefined),
        choice: vi.fn(async () => "cancel" as const),
        confirm: vi.fn(async () => true),
        open: (request) =>
          openAppContentDialog({
            ...request,
            namespace: "pier.codex",
          }),
        prompt: vi.fn(async () => null),
        update: (id, patch) =>
          updateAppContentDialog(
            id.includes(":") ? id : `pier.codex:${id}`,
            patch
          ),
        close: (id, result) =>
          closeAppContentDialog(
            id.includes(":") ? id : `pier.codex:${id}`,
            result
          ),
      },
      i18n: {
        language: () => "en",
        t: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
      },
      lifecycle: { beforeSuspend: vi.fn(() => () => undefined) },
      notifications: {
        error: vi.fn(),
        info: vi.fn(),
        loading: vi.fn(() => ({
          dismiss: vi.fn(),
          info: vi.fn(),
          success: vi.fn(),
          update: vi.fn(),
        })),
        success: vi.fn(),
      },
      panels: { register: vi.fn(() => () => undefined) },
      rpc: { invoke, on: vi.fn(() => () => undefined) },
      settingsPages: { register: vi.fn(() => () => undefined) },
      terminals: {
        open: vi.fn(() =>
          Promise.resolve({ panelId: "terminal-1", windowId: "main" })
        ),
      },
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
  it("keeps account identity outside one faded usage viewport", async () => {
    const { context } = contextWithSnapshot(usageSnapshot());
    const { container } = render(
      <AccountsWidget context={context} {...baseProps()} />
    );

    const accountLabel = await screen.findByText("test@codex.dev");
    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]'
    );

    expect(
      container.querySelectorAll('[data-slot="scroll-area"]')
    ).toHaveLength(1);
    expect(viewport).toHaveClass("scroll-fade-y", "overscroll-contain");
    expect(viewport?.contains(accountLabel)).toBe(false);
    expect(
      viewport?.querySelector('[data-slot="account-widget-usage-content"]')
    ).not.toBeNull();
  });

  afterEach(() => {
    cleanup();
    resetAppContentDialogForTests();
  });

  it("renders remaining percent for dynamic usage windows", async () => {
    const snap = usageSnapshot();
    const { context } = contextWithSnapshot(snap);
    const { container } = render(
      <>
        <AppContentDialogHost />
        <AccountsWidget context={context} {...baseProps()} />
      </>
    );

    await screen.findByText("5-hour quota");
    expect(screen.getByText("7-day quota")).toBeDefined();
    expect(container.textContent).toContain("32%");
    expect(container.textContent).toContain("68%");
    expect(screen.getAllByText("remaining")).toHaveLength(2);
  });

  it("hides the account switcher when no alternative account exists", async () => {
    const { context } = contextWithSnapshot(usageSnapshot());
    render(
      <>
        <AppContentDialogHost />
        <AccountsWidget context={context} {...baseProps()} />
      </>
    );

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
    render(
      <>
        <AppContentDialogHost />
        <AccountsWidget context={context} {...baseProps()} />
      </>
    );

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
    render(
      <>
        <AppContentDialogHost />
        <AccountsWidget context={context} {...baseProps()} />
      </>
    );

    await screen.findByText("active@codex.dev");
    openDropdown("Switch account");

    const otherOption = await screen.findByText("other@codex.dev");
    await act(async () => {
      fireEvent.click(otherOption);
    });

    // The switch confirmation dialog opens with sync checkboxes. Peers are
    // unchecked by default (overwriting other tools' credentials is opt-in);
    // check one explicitly before confirming.
    const opencodeCheckbox = await screen.findByRole("checkbox", {
      name: "OpenCode",
    });
    await act(async () => {
      fireEvent.click(opencodeCheckbox);
    });
    const switchButton = await screen.findByRole("button", {
      name: /Confirm$/,
    });
    await act(async () => {
      fireEvent.click(switchButton);
    });
    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "accounts.select",
        payload: {
          accountId: "acc-2",
          syncTargets: ["opencode"],
        },
      });
    });
  });

  it("defers the switch dialog until the next macrotask after menu select", async () => {
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
    render(
      <>
        <AppContentDialogHost />
        <AccountsWidget context={context} {...baseProps()} />
      </>
    );

    await screen.findByText("active@codex.dev");
    openDropdown("Switch account");
    await act(async () => {
      fireEvent.click(await screen.findByText("other@codex.dev"));
    });

    // Host content dialog opens without Dialog+menu nesting deferral.
    expect(
      await screen.findByRole("dialog", undefined, { timeout: 1000 })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Confirm$/ })).toBeTruthy();
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
    render(
      <>
        <AppContentDialogHost />
        <AccountsWidget context={context} {...baseProps()} />
      </>
    );

    await screen.findByText("active@codex.dev");
    openDropdown("Switch account");
    fireEvent.click(await screen.findByText("other@codex.dev"));

    // Confirm in the switch dialog to trigger the RPC.
    const switchButton = await screen.findByRole("button", {
      name: /Confirm$/,
    });
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

  it("routes manage accounts through host openSettings", async () => {
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
    render(
      <>
        <AppContentDialogHost />
        <AccountsWidget context={context} {...baseProps()} />
      </>
    );

    await screen.findByText("test@codex.dev");
    openDropdown("Switch account");

    const manageBtn = await screen.findByText("Manage accounts...");
    await act(async () => {
      fireEvent.click(manageBtn);
    });

    // openSettings is immediate; Dialog primitive defers the actual mount.
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
    // Shared refreshAccountUsage always force:true; active guard loads snapshot first.
    expect(invokeCalls).toContainEqual({
      method: "accounts.snapshot",
      payload: null,
    });
    expect(invokeCalls).toContainEqual({
      method: "accounts.refreshUsage",
      payload: { force: true },
    });
    expect(context.notifications.success).toHaveBeenCalledTimes(1);
  });

  it("refresh action alerts without success when no account is active", async () => {
    const snap = noActiveAccountSnapshot();
    const { context, invokeCalls } = contextWithSnapshot(snap);
    const [action] = accountsWidgetActions(context, {
      instanceId: "widget-1",
      params: {},
      requestRefresh: vi.fn(),
      updateParams: vi.fn(),
    });
    await action?.invoke({
      instanceId: "widget-1",
      params: {},
      requestRefresh: vi.fn(),
      updateParams: vi.fn(),
    });
    expect(invokeCalls).toContainEqual({
      method: "accounts.snapshot",
      payload: null,
    });
    expect(
      invokeCalls.filter((c) => c.method === "accounts.refreshUsage")
    ).toHaveLength(0);
    expect(context.notifications.success).not.toHaveBeenCalled();
    expect(context.dialogs.alert).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "No active account",
        title: "Could not refresh Codex usage",
      })
    );
  });

  it("renders an explicit fallback when no account is active", async () => {
    const snap = noActiveAccountSnapshot();
    const { context } = contextWithSnapshot(snap);
    render(
      <>
        <AppContentDialogHost />
        <AccountsWidget context={context} {...baseProps()} />
      </>
    );

    expect(await screen.findByText("No active account")).toBeDefined();
  });

  it("keeps every quota visible and identifiable at compact size", async () => {
    const snapshot = usageSnapshot({
      activeUsage: {
        attemptedAt: Date.now(),
        metrics: [
          {
            groupId: "codex",
            id: "codex:secondary",
            kind: "quota",
            resetsAt: Date.now() + 86_400_000,
            usedPercent: 32,
            windowMinutes: 10_080,
          },
          {
            groupId: "spark",
            id: "spark:secondary",
            kind: "quota",
            name: "GPT-5.3-Codex-Spark",
            resetsAt: Date.now() + 86_400_000,
            usedPercent: 0,
            windowMinutes: 10_080,
          },
        ],
        status: "ok",
        updatedAt: Date.now(),
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

    const meter = container.querySelector('[data-slot="account-usage-quotas"]');
    const windows = container.querySelectorAll(
      '[data-slot="account-usage-quota"]'
    );
    expect(meter?.getAttribute("data-count")).toBe("2");
    expect(meter?.className).toContain("grid");
    expect(meter?.className).toContain("content-start");
    // 列定义走 inline style，不依赖 Tailwind 任意值
    expect(meter).toHaveStyle({
      gridTemplateColumns: expect.stringContaining(
        "auto-fit"
      ) as unknown as string,
    });
    expect(windows).toHaveLength(2);
    expect(
      Array.from(windows, (window) => window.getAttribute("data-group-id"))
    ).toEqual(["codex", "spark"]);
    expect(container.querySelector('[data-slot="separator"]')).toBeNull();
    expect(
      container.querySelectorAll(
        '[data-slot="account-usage-quota"] [data-slot="progress"]'
      )
    ).toHaveLength(2);
  });

  it("forces a single quota meter onto a full-width column", async () => {
    const snapshot = usageSnapshot({
      activeUsage: {
        attemptedAt: Date.now(),
        metrics: [
          {
            groupId: "codex",
            id: "codex:primary",
            kind: "quota",
            resetsAt: Date.now() + 3_600_000,
            usedPercent: 10,
            windowMinutes: 300,
          },
        ],
        status: "ok",
        updatedAt: Date.now(),
      },
    });
    const { context } = contextWithSnapshot(snapshot);
    const { container } = render(
      <AccountsWidget context={context} {...baseProps()} />
    );

    await screen.findByText("5-hour quota");
    const meter = container.querySelector(
      '[data-slot="account-usage-quotas"][data-count="1"]'
    );
    expect(meter).not.toBeNull();
    expect(meter?.className).toContain("flex");
    expect(meter?.className).toContain("w-full");
    expect(meter?.className).not.toContain("grid");
    // 单项无 grid-template-columns（style 为 undefined）
    expect((meter as HTMLElement | null)?.style.gridTemplateColumns ?? "").toBe(
      ""
    );
    expect(
      container.querySelectorAll('[data-slot="account-usage-quota"]')
    ).toHaveLength(1);
  });

  it("keeps last-good quota meters when usage status is error", async () => {
    const snapshot = usageSnapshot({
      activeUsage: {
        attemptedAt: Date.now(),
        error: "network timeout",
        metrics: [
          {
            groupId: "codex",
            id: "codex:primary",
            kind: "quota",
            usedPercent: 40,
            windowMinutes: 300,
          },
        ],
        status: "error",
        updatedAt: Date.now(),
      },
    });
    const { context } = contextWithSnapshot(snapshot);
    const { container } = render(
      <AccountsWidget context={context} {...baseProps()} />
    );
    await screen.findByText("5-hour quota");
    expect(
      container.querySelector('[data-slot="account-usage-quotas"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-slot="widget-error"]')).toBeNull();
  });

  it("hides the whole account header on compact height", async () => {
    const { context } = contextWithSnapshot(usageSnapshot());
    const { container } = render(
      <AccountsWidget
        context={context}
        {...baseProps({ size: { w: 4, h: 2 } })}
      />
    );
    // 额度仍可见
    await screen.findByText("5-hour quota");
    expect(container.querySelector('[data-density="compact"]')).not.toBeNull();
    // 小卡整段隐藏账号区（邮箱 / 套餐 / 切换）
    expect(screen.queryByText("test@codex.dev")).toBeNull();
    expect(container.querySelector('[data-slot="item"]')).toBeNull();
  });

  it("keeps a compact account switcher when more than one account exists", async () => {
    const snapshot = usageSnapshot({
      accounts: [
        {
          error: null,
          id: "acc-1",
          label: "active@codex.dev",
          planType: "pro",
          status: "active",
        },
        {
          error: null,
          id: "acc-2",
          label: "other@codex.dev",
          planType: "pro",
          status: "available",
        },
      ],
      activeAccountId: "acc-1",
    });
    const { context } = contextWithSnapshot(snapshot);
    const { container } = render(
      <AccountsWidget
        context={context}
        {...baseProps({ size: { w: 4, h: 2 } })}
      />
    );

    await screen.findByText("active@codex.dev");
    expect(screen.getByRole("button", { name: "Switch account" })).toBeTruthy();
    expect(container.querySelector('[data-slot="avatar"]')).toBeNull();
    expect(screen.queryByText("PRO")).toBeNull();
  });

  it("promotes an expiring membership in a compact single-account widget", async () => {
    const snapshot = usageSnapshot({
      accounts: [
        {
          error: null,
          id: "acc-1",
          label: "active@codex.dev",
          planType: "pro",
          status: "active",
          subscriptionExpiresAt: Date.now() + 86_400_000,
        },
      ],
      activeAccountId: "acc-1",
    });
    const { context } = contextWithSnapshot(snapshot);
    render(
      <AccountsWidget
        context={context}
        {...baseProps({ size: { w: 4, h: 2 } })}
      />
    );

    expect(await screen.findByText(/Expires/)).toBeTruthy();
  });

  it("promotes an account error in a compact single-account widget", async () => {
    const snapshot = usageSnapshot({
      accounts: [
        {
          error: "credential missing",
          id: "acc-1",
          label: "active@codex.dev",
          status: "error",
        },
      ],
      activeAccountId: "acc-1",
    });
    const { context } = contextWithSnapshot(snapshot);
    render(
      <AccountsWidget
        context={context}
        {...baseProps({ size: { w: 4, h: 2 } })}
      />
    );

    expect(await screen.findByText("Account unavailable")).toBeTruthy();
  });

  it("registers only the account/quota widget (cost owns host core.cost-overview)", () => {
    const { context } = contextWithSnapshot(usageSnapshot());
    const register = vi.mocked(context.workbenchWidgets.register);
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
    render(
      <>
        <AppContentDialogHost />
        <AccountsWidget context={context} {...baseProps()} />
      </>
    );
    expect(screen.queryByText("Refreshing")).toBeNull();
    expect(
      document.querySelector('[data-slot="spinner"][aria-label="Refreshing"]')
    ).toBeNull();
  });
});
