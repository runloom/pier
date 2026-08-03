/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShellEnvironmentBlock } from "@/pages/settings/components/shell-environment-block.tsx";
import { useShellEnvironmentStore } from "@/stores/shell-environment.store.ts";

vi.mock("@/i18n/use-t.ts", () => ({
  useT: () => (key: string) => key,
}));

describe("ShellEnvironmentBlock", () => {
  beforeEach(() => {
    vi.stubGlobal("pier", {
      shellEnvironment: {
        refresh: vi.fn(async () => ({
          disabled: false,
          platform: "darwin",
          shellEnvStatus: "resolved",
          timeoutMs: 10_000,
        })),
        status: vi.fn(async () => ({
          disabled: false,
          platform: "darwin",
          shell: "/bin/zsh",
          shellEnvStatus: "resolved",
          timeoutMs: 10_000,
        })),
      },
    });
    useShellEnvironmentStore.setState({
      disabled: false,
      hostStatus: {
        disabled: false,
        platform: "darwin",
        shell: "/bin/zsh",
        shellEnvStatus: "resolved",
        timeoutMs: 10_000,
      },
      loading: false,
      timeoutMs: 10_000,
      loadHostStatus: async () => undefined,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders shell environment health card with status and controls", () => {
    render(<ShellEnvironmentBlock />);
    expect(
      screen.getByText("settings.shellEnvironment.title")
    ).toBeInTheDocument();
    expect(
      screen.getByText("settings.shellEnvironment.status.resolved")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "settings.shellEnvironment.refresh",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("settings.shellEnvironment.disabled")
    ).toBeInTheDocument();
  });

  it("shows Windows note when platform is win32", () => {
    useShellEnvironmentStore.setState({
      hostStatus: {
        disabled: false,
        platform: "win32",
        shellEnvStatus: "skipped",
        timeoutMs: 10_000,
      },
    });
    render(<ShellEnvironmentBlock />);
    expect(
      screen.getByText("settings.shellEnvironment.windowsNote")
    ).toBeInTheDocument();
  });
});
