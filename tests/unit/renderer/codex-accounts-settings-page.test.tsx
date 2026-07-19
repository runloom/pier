import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppContentDialogHost } from "@/components/common/app-content-dialog-host.tsx";
import {
  closeAppContentDialog,
  openAppContentDialog,
  resetAppContentDialogForTests,
  updateAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import type { ExternalRendererPluginContext } from "../../../packages/plugin-api/src/renderer.ts";
import pluginManifest from "../../../packages/plugin-codex/plugin.json" with {
  type: "json",
};
import { AccountsSettingsPage } from "../../../packages/plugin-codex/src/renderer/accounts-settings-page.tsx";
import { AddAccountDialog } from "../../../packages/plugin-codex/src/renderer/add-account-dialog.tsx";
import { usageWindowLabel } from "../../../packages/plugin-codex/src/renderer/usage-meter.tsx";
import type {
  CodexAccountsSnapshot,
  CodexUsageWindow,
} from "../../../packages/plugin-codex/src/shared/accounts.ts";

function emptySnapshot(): CodexAccountsSnapshot {
  return {
    accounts: [],
    activeAccountId: null,
    activeUsage: null,
    login: null,
    revision: 1,
    schemaVersion: 1,
  };
}

function snapshotWithAccount(
  overrides: Partial<CodexAccountsSnapshot> = {}
): CodexAccountsSnapshot {
  return {
    accounts: [
      {
        id: "acc-1",
        label: "test@codex.dev",
        planType: "pro",
        status: "active",
        error: null,
      },
    ],
    activeAccountId: "acc-1",
    activeUsage: null,
    login: null,
    revision: 2,
    schemaVersion: 1,
    ...overrides,
  };
}

function usageWindow(
  usedPercent: number,
  windowMinutes = 300,
  position: "primary" | "secondary" = "primary",
  limitName?: string
): CodexUsageWindow {
  return {
    id: `codex:${position}`,
    limitId: "codex",
    usedPercent,
    windowMinutes,
    ...(limitName ? { limitName } : {}),
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
      return { omp: true, opencode: true, pi: true } as T;
    }
    return null as T;
  };
  return {
    context: {
      app: {
        openExternal: vi.fn(async () => true),
        openSettings: vi.fn(),
      },
      actions: {
        register: vi.fn(() => () => undefined),
      },
      configuration: {
        get: vi.fn(
          () => false
        ) as ExternalRendererPluginContext["configuration"]["get"],
        onDidChange: vi.fn(() => () => undefined),
        reset: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
      },
      workbenchWidgets: {
        register: vi.fn(() => () => undefined),
      },
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
      lifecycle: {
        beforeSuspend: vi.fn(() => () => undefined),
      },
      notifications: {
        error: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
      },
      panels: { register: vi.fn(() => () => undefined) },
      rpc: {
        invoke,
        on: vi.fn(() => () => undefined),
      },
      settingsPages: {
        register: vi.fn(() => () => undefined),
      },
    },
    invokeCalls,
  };
}

function activateTab(name: string | RegExp): void {
  // Radix Tabs switches selection on mousedown; click alone is not enough.
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

describe("AccountsSettingsPage", () => {
  afterEach(() => {
    cleanup();
    resetAppContentDialogForTests();
  });

  it("renders the active account chrome without redundant copy or cost UI", async () => {
    const { context } = contextWithSnapshot(snapshotWithAccount());
    const { container } = render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Codex Accounts" })
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Add account" })).toBeDefined();
    expect(screen.getByTestId("codex-active-account")).toBeDefined();
    expect(container.querySelector('[data-slot="avatar"]')).not.toBeNull();
    expect(
      container.querySelector('[data-slot="avatar-fallback"]')
    ).toHaveTextContent("T");
    expect(container.querySelector(".pier-codex-avatar")).toBeNull();
    // v1.2: 成本 UI 已迁至宿主 core.cost-overview 物料
    expect(screen.queryByTestId("codex-cost-card")).toBeNull();
    expect(screen.getByText("PRO")).toBeDefined();
    expect(container.querySelector('[data-slot="chart"]')).toBeNull();
    expect(
      screen.queryByText(
        "Manage Codex accounts and compare session and weekly remaining limits."
      )
    ).toBeNull();
    expect("configuration" in pluginManifest).toBe(false);
  });

  it("uses responsive grids and semantic design tokens for account rows", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "packages/plugin-codex/src/renderer/styles.css"),
      "utf8"
    );
    const accountDisplay = readFileSync(
      resolve(
        process.cwd(),
        "packages/plugin-codex/src/renderer/account-display.tsx"
      ),
      "utf8"
    );

    expect(styles).not.toContain("@media");
    expect(styles).not.toContain(".pier-codex-");
    expect(accountDisplay).toContain(
      "grid-cols-[auto_15rem_minmax(17rem,1fr)_auto]"
    );
    expect(accountDisplay).not.toContain(
      "grid-cols-[auto_20rem_minmax(17rem,1fr)_auto]"
    );
    expect(accountDisplay).not.toContain("minmax(11rem,1.1fr)");
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("builds plugin utilities from plugin sources without host preflight", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "packages/plugin-codex/src/renderer/styles.css"),
      "utf8"
    );
    const globals = readFileSync(
      resolve(process.cwd(), "src/renderer/app/globals.css"),
      "utf8"
    );
    const uiPackage = readFileSync(
      resolve(process.cwd(), "packages/ui/package.json"),
      "utf8"
    );
    const pluginEntry = readFileSync(
      resolve(process.cwd(), "packages/plugin-codex/src/renderer/index.tsx"),
      "utf8"
    );

    expect(styles).toContain('@reference "@pier/ui/tailwind-theme.css"');
    expect(styles).toContain('@reference "tailwindcss/theme.css"');
    expect(styles).toContain('@source "./"');
    expect(styles).toContain(
      "@scope ([data-pier-codex-scope]) {\n  @tailwind utilities source(none);\n}"
    );
    expect(styles).not.toContain('@import "tailwindcss";');
    expect(styles).not.toContain('@import "tailwindcss/utilities.css"');
    expect(styles).not.toContain("prefix(codex)");
    expect(styles).not.toContain("@theme inline");
    expect(styles).not.toContain("src/renderer");
    expect(pluginEntry).toContain('data-pier-codex-scope=""');
    expect(globals).toContain('@import "@pier/ui/tailwind-theme.css"');
    expect(globals).not.toContain("@source ../../../packages/plugin-codex");
    expect(uiPackage).toContain(
      '"./tailwind-theme.css": "./src/tailwind-theme.css"'
    );
  });

  it("replaces Node environment checks in the browser plugin bundle", () => {
    const viteConfig = readFileSync(
      resolve(process.cwd(), "packages/plugin-codex/vite.config.renderer.ts"),
      "utf8"
    );

    expect(viteConfig).toContain('"process.env.NODE_ENV"');
    expect(viteConfig).toContain('JSON.stringify("production")');
  });

  it("formats quota durations from data in both supported languages", () => {
    const zhMessages = pluginManifest.locales["zh-CN"].messages as Record<
      string,
      string
    >;
    const zh = (key: string, fallback: string): string =>
      zhMessages[key] ?? fallback;

    expect(
      usageWindowLabel(usageWindow(5, 15), "en", (_key, fallback) => fallback)
    ).toBe("15-minute quota");
    expect(usageWindowLabel(usageWindow(5, 300), "zh-CN", zh)).toBe(
      "5 小时额度"
    );
    expect(usageWindowLabel(usageWindow(5, 10_080), "zh-CN", zh)).toBe(
      "7 天额度"
    );
    expect(usageWindowLabel(usageWindow(5, 43_200), "zh-CN", zh)).toBe(
      "30 天额度"
    );
  });

  it("keeps business periods owned by data contracts instead of UI literals", () => {
    const usageParser = readFileSync(
      resolve(process.cwd(), "packages/plugin-codex/src/main/codex-usage.ts"),
      "utf8"
    );
    const usageRenderer = readFileSync(
      resolve(
        process.cwd(),
        "packages/plugin-codex/src/renderer/usage-meter.tsx"
      ),
      "utf8"
    );

    expect(usageParser).not.toMatch(/windowMinutes\s*===/);
    expect(usageRenderer).not.toMatch(/5-hour|Weekly|Session/);
  });

  it("renders the active account without a redundant status badge", async () => {
    const { context } = contextWithSnapshot(snapshotWithAccount());
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    expect(await screen.findByText("test@codex.dev")).toBeDefined();
    expect(screen.queryByText("System default")).toBeNull();
    expect(screen.queryByText("Current")).toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
  });

  it("centers account avatars against the complete identity block", async () => {
    const { context } = contextWithSnapshot(
      snapshotWithAccount({
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
      })
    );
    const { container } = render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    await screen.findByText("other@codex.dev");
    const media = container.querySelector(
      '[data-testid="codex-account-usage-row"] [data-slot="item-media"]'
    );
    expect(media).toHaveAttribute("data-align", "center");
    expect(media).toHaveClass("self-center");
  });

  it("renders a team account's single quota without an invented empty lane", async () => {
    const { context } = contextWithSnapshot(
      snapshotWithAccount({
        accounts: [
          {
            error: null,
            id: "acc-1",
            label: "team@codex.dev",
            planType: "team",
            status: "active",
            usage: {
              fetchedAt: Date.now(),
              resetCreditsAvailable: 0,
              status: "ok",
              windows: [usageWindow(5)],
            },
          },
        ],
      })
    );
    const { container } = render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    expect(await screen.findByText(/^TEAM · Updated/)).toBeDefined();
    expect(screen.queryByText(/quota resets/)).toBeNull();
    expect(screen.getByText("5-hour quota")).toBeDefined();
    expect(screen.getByText("95%")).toBeDefined();
    expect(screen.queryByText("7-day quota")).toBeNull();
    expect(screen.queryByText("No usage data")).toBeNull();
    expect(
      container.querySelector('[data-slot="codex-quota-group"][data-count="1"]')
    ).not.toBeNull();
    // Single meter must force 1-col full width — do not leave half-row via auto-fit.
    const grid = container.querySelector(
      '[data-slot="codex-quota-grid"][data-layout="single"]'
    );
    expect(grid).not.toBeNull();
    expect(grid?.className).toContain("block");
    expect(grid?.className).toContain("w-full");
    expect(grid?.className).not.toContain("auto-fit");
    expect(grid?.className).not.toContain("grid-cols");
  });

  it("labels a 30-day named quota from its dynamic metadata", async () => {
    const { context } = contextWithSnapshot(
      snapshotWithAccount({
        accounts: [
          {
            error: null,
            id: "acc-1",
            label: "monthly@codex.dev",
            planType: "team",
            status: "active",
            usage: {
              fetchedAt: Date.now(),
              status: "ok",
              windows: [usageWindow(5, 43_200, "primary", "Code review")],
            },
          },
        ],
      })
    );
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    expect(await screen.findByText("Code review · 30-day quota")).toBeDefined();
    expect(screen.queryByText("5-hour quota")).toBeNull();
    expect(screen.queryByText("No usage data")).toBeNull();
  });

  it("shows a per-account usage error instead of an empty quota", async () => {
    const { context } = contextWithSnapshot(
      snapshotWithAccount({
        accounts: [
          {
            error: null,
            id: "acc-1",
            label: "failed@codex.dev",
            planType: "plus",
            status: "active",
            usage: {
              error: "refresh token expired",
              fetchedAt: Date.now(),
              status: "error",
              windows: [],
            },
          },
        ],
      })
    );
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    expect(await screen.findByText("Usage update failed")).toBeDefined();
    expect(screen.queryByText("No usage data")).toBeNull();
  });

  it("renders dashed empty state when no managed accounts", async () => {
    const { context } = contextWithSnapshot(emptySnapshot());
    const { container } = render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    expect(await screen.findByText("No managed accounts")).toBeDefined();
    expect(screen.queryByText("System default")).toBeNull();
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
  });

  it("opens account authorization before starting the browser login", async () => {
    const { context, invokeCalls } = contextWithSnapshot(emptySnapshot());
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    const addAccountButton = await screen.findByText("Add account");
    await act(async () => {
      fireEvent.click(addAccountButton);
    });
    expect(screen.getByText("Add Codex account")).toBeDefined();
    const dialog = screen.getByRole("dialog");
    expect(dialog.classList.contains("sm:max-w-md")).toBe(true);
    expect(
      screen
        .getByText("Credentials are stored only on this device")
        .closest('[data-slot="item"]')
    ).not.toBeNull();
    expect(invokeCalls).not.toContainEqual({
      method: "accounts.add",
      payload: {},
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Continue in browser" })
      );
    });
    expect(invokeCalls).toContainEqual({ method: "accounts.add", payload: {} });
    await vi.waitFor(() => {
      expect(screen.queryByText("Add Codex account")).toBeNull();
    });
  });

  it("imports the local account from the Local import tab", async () => {
    const { context, invokeCalls } = contextWithSnapshot(emptySnapshot());
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    const addAccountButton = await screen.findByText("Add account");
    await act(async () => {
      fireEvent.click(addAccountButton);
    });
    await act(async () => {
      activateTab("Local import");
    });
    expect(
      await screen.findByText(
        /Import the account already signed in on this device/i
      )
    ).toBeDefined();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Import local account" })
      );
    });
    expect(invokeCalls).toContainEqual({
      method: "accounts.adoptCurrent",
      payload: null,
    });
  });

  it("shows destructive confirm before removing an account", async () => {
    const multiSnap = snapshotWithAccount({
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
    const { context: ctx, invokeCalls } = contextWithSnapshot(multiSnap);
    render(<AccountsSettingsPage context={ctx} />);

    // Wait for snapshot to load
    await screen.findByText("active@codex.dev");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove: other@codex.dev" })
    );

    expect(ctx.dialogs.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "destructive" })
    );

    // After confirming, should call accounts.remove
    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "accounts.remove",
        payload: { accountId: "acc-2" },
      });
    });
  });

  it("explains session restart behavior before switching accounts", async () => {
    const snap = snapshotWithAccount({
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
    });
    const { context, invokeCalls } = contextWithSnapshot(snap);
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    await screen.findByText("other@codex.dev");
    expect(screen.queryByText("Available")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Switch: other@codex.dev" })
    );

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

  it("hides the sync-to-peers button when no peer tools are available", async () => {
    const snap = snapshotWithAccount({
      accounts: [
        {
          id: "acc-1",
          label: "active@codex.dev",
          status: "active",
          error: null,
        },
      ],
    });
    const { context } = contextWithSnapshot(snap);
    context.rpc.invoke = async <T,>(
      method: string,
      _payload?: unknown
    ): Promise<T> => {
      if (method === "accounts.snapshot") {
        return snap as T;
      }
      if (method === "accounts.peerAvailability") {
        return { omp: false, opencode: false, pi: false } as T;
      }
      return null as T;
    };
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    await screen.findByText("active@codex.dev");
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Sync to other tools" })
      ).toBeNull();
    });
  });

  it("syncs the current account credentials to peer tools without selecting", async () => {
    const snap = snapshotWithAccount({
      accounts: [
        {
          id: "acc-1",
          label: "active@codex.dev",
          status: "active",
          error: null,
        },
      ],
    });
    const { context, invokeCalls } = contextWithSnapshot(snap);
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    await screen.findByText("active@codex.dev");
    fireEvent.click(
      await screen.findByRole("button", { name: "Sync to other tools" })
    );

    expect(
      await screen.findByText("Sync OpenAI account to other tools?")
    ).toBeTruthy();
    const syncButton = await screen.findByRole("button", { name: /Sync$/ });
    await act(async () => {
      fireEvent.click(syncButton);
    });

    await vi.waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "accounts.syncToPeers",
        payload: {
          accountId: "acc-1",
          syncTargets: ["opencode", "pi", "omp"],
        },
      });
    });
    expect(invokeCalls).not.toContainEqual({
      method: "accounts.select",
      payload: expect.anything(),
    });
    expect(context.notifications.success).toHaveBeenCalledWith(
      "Synced credentials to selected tools"
    );
  });

  it("does not call accounts.syncToPeers when peer sync is cancelled", async () => {
    const snap = snapshotWithAccount({
      accounts: [
        {
          id: "acc-1",
          label: "active@codex.dev",
          status: "active",
          error: null,
        },
      ],
    });
    const { context, invokeCalls } = contextWithSnapshot(snap);
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    await screen.findByText("active@codex.dev");
    fireEvent.click(
      await screen.findByRole("button", { name: "Sync to other tools" })
    );
    const cancelButton = await screen.findByRole("button", { name: "Cancel" });
    await act(async () => {
      fireEvent.click(cancelButton);
    });
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });

    expect(invokeCalls).not.toContainEqual({
      method: "accounts.syncToPeers",
      payload: expect.anything(),
    });
  });

  it("keeps the active account when switching is cancelled", async () => {
    const snap = snapshotWithAccount({
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
    });
    const { context, invokeCalls } = contextWithSnapshot(snap);
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    await screen.findByText("other@codex.dev");
    fireEvent.click(
      screen.getByRole("button", { name: "Switch: other@codex.dev" })
    );

    // The switch dialog opens; click Cancel to dismiss without switching.
    const cancelButton = await screen.findByRole("button", { name: "Cancel" });
    await act(async () => {
      fireEvent.click(cancelButton);
    });
    // Give any pending state updates a tick to flush.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(invokeCalls).not.toContainEqual({
      method: "accounts.select",
      payload: expect.anything(),
    });
  });

  it("refreshes quota for the selected row without switching accounts", async () => {
    const snap = snapshotWithAccount({
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
    });
    const { context, invokeCalls } = contextWithSnapshot(snap);
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    await screen.findByText("other@codex.dev");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Refresh usage: other@codex.dev",
        })
      );
    });

    expect(invokeCalls).toContainEqual({
      method: "accounts.refreshUsage",
      payload: { accountId: "acc-2", force: true },
    });
    expect(invokeCalls).not.toContainEqual({
      method: "accounts.select",
      payload: { accountId: "acc-2" },
    });
  });

  it("shows a spinning refresh state and success notification", async () => {
    const snapshot = snapshotWithAccount();
    const { context } = contextWithSnapshot(snapshot);
    let resolveRefresh: (() => void) | undefined;
    const refreshPending = new Promise<void>((resolvePromise) => {
      resolveRefresh = resolvePromise;
    });
    context.rpc.invoke = async <T,>(method: string): Promise<T> => {
      if (method === "accounts.snapshot") return snapshot as T;
      if (method === "accounts.refreshUsage") await refreshPending;
      return null as T;
    };
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    const refreshButton = await screen.findByRole("button", {
      name: "Refresh usage",
    });
    fireEvent.click(refreshButton);

    await vi.waitFor(() => {
      expect(refreshButton).toBeDisabled();
      expect(refreshButton).toHaveAttribute("aria-busy", "true");
      expect(refreshButton.querySelector("svg")).toHaveClass("animate-spin");
    });

    await act(async () => {
      resolveRefresh?.();
      await refreshPending;
    });
    await vi.waitFor(() => {
      expect(refreshButton).not.toBeDisabled();
      expect(context.notifications.success).toHaveBeenCalledWith(
        "Usage refreshed"
      );
    });
  });

  it("keeps a manually opened add dialog open across unrelated re-renders", async () => {
    // Regression: a usage refresh completing re-renders the page while
    // login stays null; the dialog-lifecycle effect must only close the
    // dialog when a login actually ended, not on every re-render.
    const { context } = contextWithSnapshot(emptySnapshot());
    const t = (_key: string, fallback: string): string => fallback;
    const { rerender } = render(
      <>
        <AppContentDialogHost />
        <AddAccountDialog
          context={context}
          login={null}
          onError={vi.fn()}
          t={t}
        />
      </>
    );

    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(await screen.findByRole("dialog")).toBeDefined();

    // Unrelated re-render with fresh callback identities, login still null.
    rerender(
      <>
        <AppContentDialogHost />
        <AddAccountDialog
          context={context}
          login={null}
          onError={vi.fn()}
          t={(_key: string, fallback: string): string => fallback}
        />
      </>
    );

    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("renders the waiting dialog with cancel when login is pending", async () => {
    const snap = snapshotWithAccount({
      login: { provider: "codex", startedAt: Date.now() },
    });
    const { context } = contextWithSnapshot(snap);
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    expect(
      await screen.findByText("Waiting for browser authorization")
    ).toBeDefined();
    expect(screen.getByText("Waiting for Codex authorization…")).toBeDefined();
    expect(screen.getByText("Cancel login")).toBeDefined();
  });

  it("retains the waiting presentation while authorization closes", async () => {
    // Dialog content reads login state live from the snapshot store, so the
    // stubbed snapshot must agree with the login prop passed to the dialog.
    const { context } = contextWithSnapshot({
      ...emptySnapshot(),
      login: { provider: "codex", startedAt: Date.now() },
    });
    const t = (_key: string, fallback: string): string => fallback;
    const { rerender } = render(
      <>
        <AppContentDialogHost />
        <AddAccountDialog
          context={context}
          login={{ provider: "codex", startedAt: Date.now() }}
          onError={vi.fn()}
          t={t}
        />
      </>
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Waiting for browser authorization");
    rerender(
      <>
        <AppContentDialogHost />
        <AddAccountDialog
          context={context}
          login={null}
          onError={vi.fn()}
          t={t}
        />
      </>
    );

    // Content dialog closes when login clears; host removes the layer.
    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("cancels a pending browser login", async () => {
    const snap = snapshotWithAccount({
      login: { provider: "codex", startedAt: Date.now() },
    });
    const { context, invokeCalls } = contextWithSnapshot(snap);
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    const cancelButton = await screen.findByRole("button", {
      name: "Cancel login",
    });
    await act(async () => {
      fireEvent.click(cancelButton);
    });

    expect(invokeCalls).toContainEqual({
      method: "accounts.cancelLogin",
      payload: null,
    });
  });

  it("keeps pending login controls usable when cancellation fails", async () => {
    const snap = snapshotWithAccount({
      login: { provider: "codex", startedAt: Date.now() },
    });
    const { context } = contextWithSnapshot(snap);
    context.rpc.invoke = async <T,>(method: string): Promise<T> => {
      if (method === "accounts.snapshot") return snap as T;
      if (method === "accounts.cancelLogin") {
        throw new Error("cancel login failed");
      }
      return null as T;
    };
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    const cancelButton = await screen.findByRole("button", {
      name: "Cancel login",
    });
    await act(async () => {
      fireEvent.click(cancelButton);
    });

    await vi.waitFor(() => {
      expect(context.dialogs.alert).toHaveBeenCalledWith({
        body: "cancel login failed",
        title: "Account action failed",
      });
      expect(cancelButton).not.toBeDisabled();
    });
  });

  it("cancels the current login before reopening the browser", async () => {
    const snap = snapshotWithAccount({
      login: { provider: "codex", startedAt: Date.now() },
    });
    const { context, invokeCalls } = contextWithSnapshot(snap);
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    const reopenButton = await screen.findByRole("button", {
      name: "Reopen browser",
    });
    await act(async () => {
      fireEvent.click(reopenButton);
    });

    await vi.waitFor(() => {
      const cancelIndex = invokeCalls.findIndex(
        ({ method }) => method === "accounts.cancelLogin"
      );
      const addIndex = invokeCalls.findIndex(
        ({ method }) => method === "accounts.add"
      );
      expect(cancelIndex).toBeGreaterThanOrEqual(0);
      expect(cancelIndex).toBeLessThan(addIndex);
    });
  });

  it("shows account login failures through the plugin dialog facade", async () => {
    const snap = emptySnapshot();
    const { context } = contextWithSnapshot(snap);
    context.rpc.invoke = async <T,>(method: string): Promise<T> => {
      if (method === "accounts.snapshot") return snap as T;
      if (method === "accounts.add") throw new Error("browser login failed");
      return null as T;
    };
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    const addAccountButton = await screen.findByText("Add account");
    await act(async () => {
      fireEvent.click(addAccountButton);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Continue in browser" })
      );
    });

    await vi.waitFor(() => {
      expect(context.dialogs.alert).toHaveBeenCalledWith({
        body: "browser login failed",
        title: "Account action failed",
      });
    });
  });

  it("shows usage for system default and every managed account", async () => {
    const now = Date.now();
    const snap = snapshotWithAccount({
      accounts: [
        {
          id: "acc-1",
          label: "first@codex.dev",
          status: "active",
          error: null,
          usage: {
            fetchedAt: now,
            status: "ok",
            windows: [usageWindow(32), usageWindow(68, 10_080, "secondary")],
          },
        },
        {
          id: "acc-2",
          label: "second@codex.dev",
          status: "available",
          error: null,
          usage: {
            fetchedAt: now,
            status: "ok",
            windows: [usageWindow(15), usageWindow(40, 10_080, "secondary")],
          },
        },
      ],
    });
    const { context } = contextWithSnapshot(snap);
    const { container } = render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    await screen.findByText("first@codex.dev");
    expect(screen.getByText("second@codex.dev")).toBeDefined();
    expect(
      container.querySelectorAll('[data-slot="codex-usage-progress"]')
    ).toHaveLength(4);
    expect(
      container.querySelector('[data-risk="normal"] [data-slot="progress"]')
    ).toHaveAttribute("data-variant", "success");
    expect(container.textContent).toContain("68%");
    expect(container.textContent).toContain("32%");
    expect(container.textContent).toContain("5-hour quota");
  });

  it("uses semantic progress variants at warning and critical thresholds", async () => {
    const now = Date.now();
    const snap = snapshotWithAccount({
      accounts: [
        {
          id: "acc-1",
          label: "thresholds@codex.dev",
          status: "active",
          error: null,
          usage: {
            fetchedAt: now,
            status: "ok",
            windows: [usageWindow(75), usageWindow(90, 10_080, "secondary")],
          },
        },
      ],
    });
    const { context } = contextWithSnapshot(snap);
    const { container } = render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    await screen.findByText("thresholds@codex.dev");
    expect(
      container.querySelector('[data-risk="warning"] [data-slot="progress"]')
    ).toHaveAttribute("data-variant", "warning");
    expect(
      container.querySelector('[data-risk="critical"] [data-slot="progress"]')
    ).toHaveAttribute("data-variant", "destructive");
    expect(
      screen.getByRole("progressbar", {
        name: "5-hour quota 25%",
      })
    ).toBeDefined();
    expect(
      screen.getByRole("progressbar", {
        name: "7-day quota 10%",
      })
    ).toBeDefined();
    expect(container.textContent).toContain("25%");
    expect(container.textContent).toContain("10%");
  });

  it("distinguishes initial loading, successful empty usage, and failure", async () => {
    const now = Date.now();
    const snap = snapshotWithAccount({
      accounts: [
        {
          id: "acc-1",
          label: "missing@codex.dev",
          status: "active",
          error: null,
        },
        {
          id: "acc-2",
          label: "empty@codex.dev",
          status: "available",
          error: null,
          usage: {
            fetchedAt: now,
            status: "ok",
            windows: [],
          },
        },
        {
          id: "acc-3",
          label: "failed@codex.dev",
          status: "error",
          error: null,
          usage: {
            error: "network unavailable",
            fetchedAt: now,
            status: "error",
            windows: [],
          },
        },
      ],
    });
    const { context } = contextWithSnapshot(snap);
    render(
      <>
        <AppContentDialogHost />
        <AccountsSettingsPage context={context} />
      </>
    );

    await screen.findByText("missing@codex.dev");
    expect(
      document.querySelectorAll('[data-slot="codex-usage-loading"]')
    ).toHaveLength(1);
    expect(screen.getAllByText("No usage data")).toHaveLength(1);
    expect(screen.getAllByText("Usage update failed")).toHaveLength(1);
  });
});
