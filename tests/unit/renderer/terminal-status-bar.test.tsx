import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForegroundActivityBridge } from "@/components/common/foreground-activity-bridge.tsx";
import {
  CORE_AGENT_STATUS_ITEM_ID,
  CORE_TERMINAL_STATUS_ITEMS,
} from "@/panel-kits/terminal/core-terminal-status-items.ts";
import {
  TerminalStatusBar,
  terminalStatusItemRegistry,
} from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useLocalEnvironmentsStore } from "@/stores/local-environments.store.ts";

function installForegroundActivityApi(): void {
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      foregroundActivity: {
        onChanged: vi.fn(() => () => undefined),
        snapshot: vi.fn(async () => ({ activities: [], ts: 1 })),
      },
    },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  terminalStatusItemRegistry.clearForTests();
  useForegroundActivityStore.setState({ activities: {}, ts: 0 });
  useLocalEnvironmentsStore.setState({
    projects: [],
    version: 1,
    worktreeBindings: [],
  });
});

describe("core terminal status items declarations", () => {
  it("declares agent status only, without an environment status core item", () => {
    const ids = CORE_TERMINAL_STATUS_ITEMS.map((item) => item.id);

    expect(ids).toEqual([CORE_AGENT_STATUS_ITEM_ID]);
    expect(ids).not.toContain("core.environment-status");
  });
});

describe("ForegroundActivityBridge terminal status registration", () => {
  it("registers agent status only", async () => {
    installForegroundActivityApi();

    render(<ForegroundActivityBridge />);

    await waitFor(() => {
      expect(
        terminalStatusItemRegistry.list().map((item) => item.id)
      ).toContain(CORE_AGENT_STATUS_ITEM_ID);
    });
    expect(
      terminalStatusItemRegistry.list().map((item) => item.id)
    ).not.toContain("core.environment-status");
  });

  it("does not mount environment selection in a project terminal status bar", async () => {
    installForegroundActivityApi();
    useLocalEnvironmentsStore.setState({
      projects: [
        {
          cleanupCommand: "",
          copyPatterns: [],
          env: {},
          projectRootPath: "/repo",
          setupCommand: "",
          updatedAt: 2,
        },
      ],
      version: 1,
      worktreeBindings: [],
    });

    render(
      <>
        <ForegroundActivityBridge />
        <TerminalStatusBar
          context={{
            contextId: "ctx-1",
            projectRootPath: "/repo",
            updatedAt: 1,
          }}
          cwd="/repo"
          panelId="terminal-1"
          title={null}
        />
      </>
    );

    await waitFor(() => {
      expect(
        terminalStatusItemRegistry.list().map((item) => item.id)
      ).toContain(CORE_AGENT_STATUS_ITEM_ID);
    });
    expect(screen.queryByTestId("environment-status")).toBeNull();
    expect(screen.queryByText("Pier")).toBeNull();
  });
});
