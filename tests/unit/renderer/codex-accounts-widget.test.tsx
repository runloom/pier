import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalRendererPluginContext } from "../../../packages/plugin-api/src/renderer.ts";
import { AccountsWidget } from "../../../packages/plugin-codex/src/renderer/accounts-widget.tsx";
import type { CodexAccountsSnapshot } from "../../../packages/plugin-codex/src/shared/accounts.ts";

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
      actions: {
        register: vi.fn(() => () => undefined),
      },
      configuration: {
        get: vi.fn(),
        onDidChange: vi.fn(() => () => undefined),
        reset: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
      },
      missionControlWidgets: {
        register: vi.fn(() => () => undefined),
      },
      dialogs: {
        alert: vi.fn(),
        confirm: vi.fn(),
      },
      i18n: {
        t: vi.fn((key: string, fallback?: string) => fallback ?? key),
      },
      notifications: {
        error: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
      },
      rpc: {
        invoke,
        on: vi.fn(() => () => undefined),
      },
    },
    invokeCalls,
  };
}

describe("Codex AccountsWidget", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an add control when no plugin-local accounts exist", async () => {
    const { context, invokeCalls } = contextWithSnapshot({
      accounts: [],
      activeAccountId: null,
      login: null,
      revision: 1,
      schemaVersion: 1,
    });

    const { container } = render(<AccountsWidget context={context} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add account" }));

    expect(invokeCalls).toContainEqual({
      method: "accounts.add",
      payload: {},
    });
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("data-slot", "button");
    }
  });

  it("renders switch and cancel controls for account workflows", async () => {
    const { context, invokeCalls } = contextWithSnapshot({
      accounts: [
        { id: "active", label: "active@example.com", status: "active" },
        { id: "other", label: "other@example.com", status: "available" },
      ],
      activeAccountId: "active",
      login: { provider: "codex", startedAt: 1 },
      revision: 1,
      schemaVersion: 1,
    });

    const { container } = render(<AccountsWidget context={context} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Switch to other@example.com" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel login" }));

    await waitFor(() => {
      expect(invokeCalls).toContainEqual({
        method: "accounts.select",
        payload: { accountId: "other" },
      });
      expect(invokeCalls).toContainEqual({
        method: "accounts.cancelLogin",
        payload: null,
      });
    });
    expect(container.querySelectorAll('[data-slot="badge"]').length).toBe(3);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("data-slot", "button");
    }
  });
});
