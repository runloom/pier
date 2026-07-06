import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDialogHost } from "@/components/common/app-dialog-host.tsx";
import { AppQuitDialogBridge } from "@/components/common/app-quit-dialog-bridge.tsx";
import { initI18n } from "@/i18n/index.ts";
import { resetAppDialogForTests } from "@/stores/app-dialog.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { resetTerminalInputRoutingForTests } from "@/stores/terminal-input-routing-slice.ts";

interface QuitActivitySummary {
  commandLine?: string;
  kind: "agent" | "shell" | "task";
  label: string;
  panelId: string;
  windowId: string;
}

interface AppQuitRequestPayload {
  quitId: string;
  summaries: readonly QuitActivitySummary[];
}

type AppQuitDecision = "cancel" | "quit";

type AppQuitRequestListener = (payload: AppQuitRequestPayload) => void;

const THREE_ACTIVITIES_TEXT_RE =
  /Vite dev server \(terminal\), codex-agent \(agent\), Build web \(task\) are still running\./;
const ONE_ACTIVITY_TEXT_RE = /Vite dev server \(terminal\) is still running\./;
const BLANK_LINE_TEXT_RE = /\n\s*\n/;
const QUIT_TERMINATES_THEM_TEXT_RE = /Quitting Pier will terminate them\./;
const QUIT_TERMINATES_IT_TEXT_RE = /Quitting Pier will terminate it\./;
const STILL_RUNNING_TEXT_RE = /still running/;
const OLD_SERVER_TEXT_RE = /old server \(terminal\)/;
const NEW_AGENT_TEXT_RE = /new agent \(agent\)/;
const ZH_SINGLE_AGENT_TEXT_RE = /claude（Agent）仍在运行。/;
const ZH_TERMINATE_SINGLE_TEXT_RE = /退出 Pier 会终止该进程。/;
const OLD_AGENT_SUMMARY_TEXT_RE = /agent: claude/;

function shellSummary(overrides: Partial<QuitActivitySummary> = {}) {
  return {
    commandLine: "pnpm dev -- --host",
    kind: "shell" as const,
    label: "Vite dev server",
    panelId: "terminal-panel",
    windowId: "main-window",
    ...overrides,
  };
}

function agentSummary(overrides: Partial<QuitActivitySummary> = {}) {
  return {
    kind: "agent" as const,
    label: "codex-agent",
    panelId: "agent-panel",
    windowId: "main-window",
    ...overrides,
  };
}

function taskSummary(overrides: Partial<QuitActivitySummary> = {}) {
  return {
    kind: "task" as const,
    label: "Build web",
    panelId: "task-panel",
    windowId: "main-window",
    ...overrides,
  };
}

function installAppQuitApi() {
  const bridge: { listener?: AppQuitRequestListener } = {};
  const dispose = vi.fn();
  const decide = vi.fn(
    async (_decision: { decision: AppQuitDecision; quitId: string }) =>
      undefined
  );
  const onRequested = vi.fn((listener: AppQuitRequestListener) => {
    bridge.listener = listener;
    return dispose;
  });

  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      appQuit: {
        decide,
        onRequested,
      },
      onWindowLayoutPulse: vi.fn(() => vi.fn()),
      terminal: { applyInputRouting: vi.fn() },
    },
  });

  return { bridge, decide, dispose, onRequested };
}

function renderBridgeAndHost() {
  return render(
    <>
      <AppQuitDialogBridge />
      <AppDialogHost />
    </>
  );
}

function sendQuitRequest(
  listener: AppQuitRequestListener | undefined,
  payload: AppQuitRequestPayload
) {
  expect(listener).toBeDefined();
  act(() => {
    listener?.(payload);
  });
}

describe("AppQuitDialogBridge", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetTerminalInputRoutingForTests();
    await initI18n();
    await i18next.changeLanguage("en");
    useKeybindingScope.setState({
      activePanelComponent: null,
      activePanelId: null,
      activePanelKind: null,
      overlayStack: [],
    });
  });

  afterEach(() => {
    act(() => {
      resetAppDialogForTests();
    });
    cleanup();
    Reflect.deleteProperty(window, "pier");
  });

  it("shows dangerous quit activity summaries and sends quit when the user confirms", async () => {
    const { bridge, decide, onRequested } = installAppQuitApi();
    renderBridgeAndHost();

    expect(onRequested).toHaveBeenCalledOnce();

    sendQuitRequest(bridge.listener, {
      quitId: "quit-dangerous",
      summaries: [shellSummary(), agentSummary(), taskSummary()],
    });

    expect(await screen.findByText("Quit Pier?")).toBeVisible();
    expect(screen.getByRole("alertdialog")).toHaveAttribute("data-size", "sm");
    expect(screen.getByText(THREE_ACTIVITIES_TEXT_RE)).toBeVisible();
    expect(screen.getByText(QUIT_TERMINATES_THEM_TEXT_RE)).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Quit" })).toHaveAttribute(
      "data-variant",
      "destructive"
    );

    fireEvent.click(screen.getByRole("button", { name: "Quit" }));

    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith({
        decision: "quit",
        quitId: "quit-dangerous",
      });
    });
  });

  it("keeps the single dangerous activity body compact while preserving the activity name", async () => {
    const { bridge, decide } = installAppQuitApi();
    renderBridgeAndHost();

    sendQuitRequest(bridge.listener, {
      quitId: "quit-single-activity",
      summaries: [shellSummary()],
    });

    const description = await screen.findByText(ONE_ACTIVITY_TEXT_RE);
    const bodyText = description.textContent ?? "";

    expect(bodyText).toContain("Vite dev server (terminal) is still running.");
    expect(bodyText).toContain("Quitting Pier will terminate it.");
    expect(bodyText).not.toContain("pnpm dev -- --host");
    expect(screen.getByText(QUIT_TERMINATES_IT_TEXT_RE)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith({
        decision: "cancel",
        quitId: "quit-single-activity",
      });
    });
    expect(bodyText).not.toMatch(BLANK_LINE_TEXT_RE);
  });

  it("uses natural Chinese copy for a single running agent", async () => {
    await i18next.changeLanguage("zh-CN");
    const { bridge } = installAppQuitApi();
    renderBridgeAndHost();

    sendQuitRequest(bridge.listener, {
      quitId: "quit-single-agent-zh",
      summaries: [agentSummary({ label: "claude" })],
    });

    expect(await screen.findByText("退出 Pier？")).toBeVisible();
    expect(screen.getByText(ZH_SINGLE_AGENT_TEXT_RE)).toBeVisible();
    expect(screen.getByText(ZH_TERMINATE_SINGLE_TEXT_RE)).toBeVisible();
    expect(
      screen.queryByText(OLD_AGENT_SUMMARY_TEXT_RE)
    ).not.toBeInTheDocument();
  });

  it("explains that the window layout will be saved when no activities are running", async () => {
    const { bridge, decide } = installAppQuitApi();
    renderBridgeAndHost();

    sendQuitRequest(bridge.listener, {
      quitId: "quit-empty",
      summaries: [],
    });

    expect(await screen.findByText("Quit Pier?")).toBeVisible();
    expect(screen.getByRole("alertdialog")).toHaveAttribute("data-size", "sm");
    expect(
      screen.getByText(
        "Pier will save the current window layout before quitting."
      )
    ).toBeVisible();
    expect(screen.queryByText(STILL_RUNNING_TEXT_RE)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quit" })).toHaveAttribute(
      "data-variant",
      "default"
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith({
        decision: "cancel",
        quitId: "quit-empty",
      });
    });
  });

  it("sends cancel when the user cancels, presses Escape, or the dialog closes", async () => {
    const cancelCase = installAppQuitApi();
    const firstRender = renderBridgeAndHost();
    sendQuitRequest(cancelCase.bridge.listener, {
      quitId: "quit-cancel-button",
      summaries: [shellSummary()],
    });
    expect(await screen.findByText("Quit Pier?")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(cancelCase.decide).toHaveBeenCalledWith({
        decision: "cancel",
        quitId: "quit-cancel-button",
      });
    });
    firstRender.unmount();
    act(() => {
      resetAppDialogForTests();
    });

    const escapeCase = installAppQuitApi();
    const secondRender = renderBridgeAndHost();
    sendQuitRequest(escapeCase.bridge.listener, {
      quitId: "quit-escape",
      summaries: [agentSummary()],
    });
    expect(await screen.findByText("Quit Pier?")).toBeVisible();

    fireEvent.keyDown(document, { code: "Escape", key: "Escape" });

    await waitFor(() => {
      expect(escapeCase.decide).toHaveBeenCalledWith({
        decision: "cancel",
        quitId: "quit-escape",
      });
    });
    secondRender.unmount();
    act(() => {
      resetAppDialogForTests();
    });

    const closeCase = installAppQuitApi();
    renderBridgeAndHost();
    sendQuitRequest(closeCase.bridge.listener, {
      quitId: "quit-close",
      summaries: [taskSummary()],
    });
    expect(await screen.findByText("Quit Pier?")).toBeVisible();

    act(() => {
      resetAppDialogForTests();
    });

    await waitFor(() => {
      expect(closeCase.decide).toHaveBeenCalledWith({
        decision: "cancel",
        quitId: "quit-close",
      });
    });
  });

  it("replaces an in-flight request with one dialog and cancels the old quit id", async () => {
    const { bridge, decide } = installAppQuitApi();
    renderBridgeAndHost();

    sendQuitRequest(bridge.listener, {
      quitId: "quit-old",
      summaries: [shellSummary({ label: "old server" })],
    });
    expect(await screen.findByText("Quit Pier?")).toBeVisible();
    expect(screen.getByText(OLD_SERVER_TEXT_RE)).toBeVisible();

    sendQuitRequest(bridge.listener, {
      quitId: "quit-new",
      summaries: [agentSummary({ label: "new agent" })],
    });

    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith({
        decision: "cancel",
        quitId: "quit-old",
      });
    });
    expect(screen.queryByText(OLD_SERVER_TEXT_RE)).not.toBeInTheDocument();
    expect(screen.getByText(NEW_AGENT_TEXT_RE)).toBeVisible();
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Quit" }));

    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith({
        decision: "quit",
        quitId: "quit-new",
      });
    });
  });
});
