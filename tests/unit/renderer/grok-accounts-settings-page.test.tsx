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
import { AccountsSettingsPage } from "../../../packages/plugin-grok/src/renderer/accounts-settings-page.tsx";
import type { GrokAccountsSnapshot } from "../../../packages/plugin-grok/src/shared/accounts.ts";

function emptySnapshot(): GrokAccountsSnapshot {
  return {
    accounts: [],
    activeAccountId: null,
    login: null,
    revision: 1,
    schemaVersion: 1,
  };
}

function snapshotWithAccounts(): GrokAccountsSnapshot {
  return {
    accounts: [
      {
        email: "active@example.com",
        error: null,
        id: "acc-active",
        kind: "oidc",
        label: "active@example.com",
        status: "active",
      },
      {
        error: null,
        id: "acc-api",
        kind: "api_key",
        label: "Work key",
        status: "available",
      },
    ],
    activeAccountId: "acc-active",
    login: null,
    revision: 2,
    schemaVersion: 1,
  };
}

function contextWithSnapshot(snapshot: GrokAccountsSnapshot): {
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
      workbenchWidgets: {
        register: vi.fn(() => () => undefined),
      },
      dialogs: {
        alert: vi.fn(async () => undefined),
        confirm: vi.fn(async () => true),
        open: (request) =>
          openAppContentDialog({
            ...request,
            namespace: "pier.grok",
          }),
        update: (id, patch) =>
          updateAppContentDialog(
            id.includes(":") ? id : `pier.grok:${id}`,
            patch
          ),
        close: (id, result) =>
          closeAppContentDialog(
            id.includes(":") ? id : `pier.grok:${id}`,
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
afterEach(() => {
  cleanup();
  resetAppContentDialogForTests();
});

describe("Grok accounts settings page", () => {
  it("hides the sync-to-peers button when no peer tools are available", async () => {
    const snap = snapshotWithAccounts();
    const { context } = contextWithSnapshot(snap);
    context.rpc.invoke = async <T,>(method: string): Promise<T> => {
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
    await screen.findByText("active@example.com");
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Sync to other tools" })
      ).toBeNull();
    });
  });

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
    expect(screen.getByText("Work key")).toBeTruthy();
    expect(screen.getByText("Other accounts")).toBeTruthy();
    // Codex parity: other-accounts card shows a count badge in CardAction.
    const otherHeading = screen.getByText("Other accounts");
    const otherCard = otherHeading.closest('[data-slot="card"]');
    expect(otherCard).not.toBeNull();
    expect(otherCard?.textContent ?? "").toMatch(/Other accounts\s*1/);
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
    expect(await screen.findByText("Switch Grok account?")).toBeTruthy();
    const confirm = await screen.findByRole("button", { name: "Confirm" });
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => {
      expect(
        invokeCalls.some(
          (call) =>
            call.method === "accounts.select" &&
            Boolean(
              call.payload &&
                typeof call.payload === "object" &&
                "accountId" in call.payload &&
                call.payload.accountId === "acc-api"
            )
        )
      ).toBe(true);
    });
  });

  it("adds an api key account from the API key tab", async () => {
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
      activateTab("API key");
    });
    const keyInput = await screen.findByPlaceholderText("xai-...");
    await act(async () => {
      fireEvent.change(keyInput, { target: { value: "xai-test-key" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
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
                call.payload.kind === "api_key" &&
                "apiKey" in call.payload &&
                call.payload.apiKey === "xai-test-key"
            )
        )
      ).toBe(true);
    });
  });

  it("starts browser OAuth from the account login footer", async () => {
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
    expect(
      await screen.findByRole("tab", { name: "Account login" })
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Continue in browser" })
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
                call.payload.kind === "oidc" &&
                "mode" in call.payload &&
                call.payload.mode === "oauth"
            )
        )
      ).toBe(true);
    });
  });

  it("starts device code login from the account login footer", async () => {
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
      fireEvent.click(screen.getByRole("button", { name: "Use device code" }));
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
                call.payload.kind === "oidc" &&
                "mode" in call.payload &&
                call.payload.mode === "device"
            )
        )
      ).toBe(true);
    });
  });

  it("imports the local account from the Local import tab", async () => {
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
      activateTab("Local import");
    });
    expect(
      await screen.findByText(
        /Import the account already signed in on this device/i
      )
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Import local account" })
      );
    });
    await waitFor(() => {
      expect(
        invokeCalls.some(
          (call) =>
            call.method === "accounts.adoptCurrent" && call.payload === null
        )
      ).toBe(true);
    });
  });
});
