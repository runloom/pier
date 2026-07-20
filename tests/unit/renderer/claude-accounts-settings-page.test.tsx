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
import { AccountsSettingsPage } from "../../../packages/plugin-claude/src/renderer/accounts-settings-page.tsx";
import type { ClaudeAccountsSnapshot } from "../../../packages/plugin-claude/src/shared/accounts.ts";

function emptySnapshot(): ClaudeAccountsSnapshot {
  return {
    accounts: [],
    activeAccountId: null,
    login: null,
    revision: 1,
    schemaVersion: 1,
  };
}

function snapshotWithAccounts(): ClaudeAccountsSnapshot {
  return {
    accounts: [
      {
        email: "active@example.com",
        error: null,
        id: "acc-active",
        label: "active@example.com",
        status: "active",
        subscription: { planType: "max" },
      },
      {
        email: "other@example.com",
        error: null,
        id: "acc-other",
        label: "other@example.com",
        status: "available",
        subscription: { planType: "pro" },
      },
    ],
    activeAccountId: "acc-active",
    login: null,
    revision: 2,
    schemaVersion: 1,
  };
}

function contextWithSnapshot(snapshot: ClaudeAccountsSnapshot): {
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
            namespace: "pier.claude",
          }),
        prompt: vi.fn(async () => null),
        update: (id, patch) =>
          updateAppContentDialog(
            id.includes(":") ? id : `pier.claude:${id}`,
            patch
          ),
        close: (id, result) =>
          closeAppContentDialog(
            id.includes(":") ? id : `pier.claude:${id}`,
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

afterEach(() => {
  cleanup();
  resetAppContentDialogForTests();
});

describe("Claude accounts settings page", () => {
  it("shows empty state when no accounts", async () => {
    const { context } = contextWithSnapshot(emptySnapshot());
    await act(async () => {
      render(
        <>
          <AppContentDialogHost />
          <AccountsSettingsPage context={context} />
        </>
      );
    });
    expect(await screen.findByText("No managed accounts")).toBeTruthy();
  });

  it("shows active and other accounts", async () => {
    const { context } = contextWithSnapshot(snapshotWithAccounts());
    await act(async () => {
      render(
        <>
          <AppContentDialogHost />
          <AccountsSettingsPage context={context} />
        </>
      );
    });
    expect(await screen.findByText("active@example.com")).toBeTruthy();
    expect(screen.getByText("other@example.com")).toBeTruthy();
    expect(screen.getByText("Other accounts")).toBeTruthy();
  });

  it("does not render a snapshot error banner (alerts are the single feedback channel)", async () => {
    const snap = snapshotWithAccounts();
    snap.lastActionError = {
      at: Date.now(),
      message: "No stored Claude credential",
    };
    const { context } = contextWithSnapshot(snap);
    await act(async () => {
      render(
        <>
          <AppContentDialogHost />
          <AccountsSettingsPage context={context} />
        </>
      );
    });
    await screen.findByText("active@example.com");
    // Action failures surface via context.dialogs.alert; a persistent banner
    // would double-report (Codex/Grok render no snapshot error banner either).
    expect(screen.queryByTestId("claude-last-action-error")).toBeNull();
  });

  it("offers remove on the active account and clears via RPC", async () => {
    const { context, invokeCalls } = contextWithSnapshot(
      snapshotWithAccounts()
    );
    await act(async () => {
      render(
        <>
          <AppContentDialogHost />
          <AccountsSettingsPage context={context} />
        </>
      );
    });
    await screen.findByText("active@example.com");
    const removeButton = screen.getByRole("button", {
      name: "Remove: active@example.com",
    });
    await act(async () => {
      fireEvent.click(removeButton);
    });
    await waitFor(() => {
      expect(context.dialogs.confirm).toHaveBeenCalled();
      expect(
        invokeCalls.some(
          (call) =>
            call.method === "accounts.remove" &&
            Boolean(
              call.payload &&
                typeof call.payload === "object" &&
                "accountId" in call.payload &&
                call.payload.accountId === "acc-active"
            )
        )
      ).toBe(true);
    });
  });

  it("shows the API-key-mode notice when detected", async () => {
    const snap = snapshotWithAccounts();
    snap.apiKeyModeDetected = true;
    const { context } = contextWithSnapshot(snap);
    await act(async () => {
      render(
        <>
          <AppContentDialogHost />
          <AccountsSettingsPage context={context} />
        </>
      );
    });
    expect(await screen.findByTestId("claude-api-key-mode")).toBeTruthy();
    expect(screen.getByText("API key mode detected")).toBeTruthy();
  });

  it("opens switch confirm dialog before selecting accounts", async () => {
    const { context, invokeCalls } = contextWithSnapshot(
      snapshotWithAccounts()
    );
    await act(async () => {
      render(
        <>
          <AppContentDialogHost />
          <AccountsSettingsPage context={context} />
        </>
      );
    });
    const switchButton = await screen.findByRole("button", { name: /Switch/ });
    await act(async () => {
      fireEvent.click(switchButton);
    });
    await waitFor(() => {
      expect(context.dialogs.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Switch Claude account?",
        })
      );
      expect(
        invokeCalls.some(
          (call) =>
            call.method === "accounts.select" &&
            Boolean(
              call.payload &&
                typeof call.payload === "object" &&
                "accountId" in call.payload &&
                call.payload.accountId === "acc-other"
            )
        )
      ).toBe(true);
    });
  });

  it("imports the current login from the add dialog local tab", async () => {
    const { context, invokeCalls } = contextWithSnapshot(emptySnapshot());
    await act(async () => {
      render(
        <>
          <AppContentDialogHost />
          <AccountsSettingsPage context={context} />
        </>
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add account/i }));
    });
    // Radix Tabs switches selection on mousedown; click alone is not enough.
    const localTab = await screen.findByRole("tab", { name: "Local import" });
    await act(async () => {
      fireEvent.mouseDown(localTab, { button: 0 });
      fireEvent.click(localTab);
    });
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Import current login" })
      );
    });
    await waitFor(() => {
      expect(
        invokeCalls.some((call) => call.method === "accounts.adoptCurrent")
      ).toBe(true);
    });
  });

  it("starts the browser OAuth flow from the default tab", async () => {
    const { context, invokeCalls } = contextWithSnapshot(emptySnapshot());
    await act(async () => {
      render(
        <>
          <AppContentDialogHost />
          <AccountsSettingsPage context={context} />
        </>
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add account/i }));
    });
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Sign in with browser" })
      );
    });
    await waitFor(() => {
      expect(
        invokeCalls.some(
          (call) =>
            call.method === "accounts.add" &&
            Boolean(
              call.payload &&
                typeof call.payload === "object" &&
                "kind" in call.payload &&
                call.payload.kind === "oauth"
            )
        )
      ).toBe(true);
    });
  });

  it("shows the paste-code step and completes the login when a session is live", async () => {
    const snap = emptySnapshot();
    snap.login = {
      authorizeUrl: "https://claude.ai/oauth/authorize?x=1",
      provider: "claude",
      startedAt: Date.now(),
    };
    const { context, invokeCalls } = contextWithSnapshot(snap);
    await act(async () => {
      render(
        <>
          <AppContentDialogHost />
          <AccountsSettingsPage context={context} />
        </>
      );
    });
    // A pending login auto-opens the add dialog on the paste-code step
    // (Codex/Grok parity) — no click needed.
    const codeInput = await screen.findByLabelText("Authorization code");
    await act(async () => {
      fireEvent.change(codeInput, { target: { value: "the-code#state" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Complete login" }));
    });
    await waitFor(() => {
      expect(
        invokeCalls.some(
          (call) =>
            call.method === "accounts.completeLogin" &&
            Boolean(
              call.payload &&
                typeof call.payload === "object" &&
                "code" in call.payload &&
                call.payload.code === "the-code#state"
            )
        )
      ).toBe(true);
    });
  });
});
