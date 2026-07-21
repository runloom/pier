import type { ExternalNavigationResult } from "@shared/contracts/external-navigation.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { AgentsSection } from "@/pages/settings/components/agents-section.tsx";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import type * as AppDialogStoreModule from "@/stores/app-dialog.store.ts";
import { makeFakePreferences } from "../../setup/preferences-fixture.ts";

const appDialogMocks = vi.hoisted(() => ({
  showAppAlert: vi.fn(async () => undefined),
}));

const toastMocks = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

// Vitest must load the real store through its mock factory before overriding one export.
vi.mock("@/stores/app-dialog.store.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof AppDialogStoreModule>()),
  showAppAlert: appDialogMocks.showAppAlert,
}));

/**
 * agent-preferences store 只关心 agent 设置字段, 但整个 preferences 对象
 * 需要完整——用 makeFakePreferences() 补齐其他默认。DEFAULT_PREFERENCES 仅
 * 保留 store 关心的字段, 便于 setState 直接使用。
 */
const DEFAULT_PREFERENCES = {
  agentCommandOverrides: {},
  agentDefaultArgs: {},
  agentDefaultEnv: {},
  agentPermissionMode: "manual" as const,
  agentStatusHooks: true,
  defaultAgentId: null,
  disabledAgentIds: [],
};

function makePierMock(detectedIds: string[] = []) {
  return {
    agents: {
      detect: vi.fn(async () => ({ detectedIds })),
      refresh: vi.fn(async () => ({ detectedIds })),
    },
    externalNavigation: {
      open: vi.fn(
        async (): Promise<ExternalNavigationResult> => ({
          opened: true,
        })
      ),
    },
    preferences: {
      read: vi.fn(async () => makeFakePreferences(DEFAULT_PREFERENCES)),
      update: vi.fn(async (patch: Record<string, unknown>) =>
        makeFakePreferences({
          ...DEFAULT_PREFERENCES,
          ...patch,
        })
      ),
      onChanged: vi.fn(() => () => undefined),
    },
  };
}

describe("AgentsSection", () => {
  beforeEach(async () => {
    await initI18n();
    appDialogMocks.showAppAlert.mockClear();
    toastMocks.info.mockClear();
    toastMocks.success.mockClear();

    useAgentDetectStore.setState({
      detectedIds: [],
      hasDetected: false,
      isDetecting: false,
      isRefreshing: false,
    });
    useAgentPreferencesStore.setState(DEFAULT_PREFERENCES);

    Object.defineProperty(window, "pier", {
      configurable: true,
      value: makePierMock(["claude"]),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAgentDetectStore.setState({
      detectedIds: [],
      hasDetected: false,
      isDetecting: false,
      isRefreshing: false,
    });
    useAgentPreferencesStore.setState(DEFAULT_PREFERENCES);
  });

  it("renders the section heading", () => {
    render(<AgentsSection />);
    expect(screen.getByText("Agents")).toBeInTheDocument();
  });

  it("renders the Auto chip", () => {
    const { container } = render(<AgentsSection />);
    const autoBtn = screen.getByRole("radio", { name: "Auto" });
    expect(autoBtn).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="toggle-group"]')
    ).not.toBeNull();
    expect(autoBtn).toHaveAttribute("data-slot", "toggle-group-item");
  });

  it("Auto pressed and Blank not pressed when defaultAgentId is null", () => {
    useAgentPreferencesStore.setState({
      ...DEFAULT_PREFERENCES,
      defaultAgentId: null,
    });
    render(<AgentsSection />);
    expect(screen.getByRole("radio", { name: "Auto" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(
      screen.getByRole("radio", { name: "Blank terminal" })
    ).toHaveAttribute("aria-checked", "false");
  });

  it("Blank pressed and Auto not pressed when defaultAgentId is blank", () => {
    // Regression: "blank" is a distinct choice, not an auto-fallback. Even
    // though "blank" is never in detectedIds, Auto must NOT light up.
    useAgentDetectStore.setState({ detectedIds: ["claude"] });
    useAgentPreferencesStore.setState({
      ...DEFAULT_PREFERENCES,
      defaultAgentId: "blank",
    });
    render(<AgentsSection />);
    expect(
      screen.getByRole("radio", { name: "Blank terminal" })
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Auto" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  it("renders agent-row-claude after detect resolves", async () => {
    render(<AgentsSection />);
    await waitFor(() => {
      expect(screen.getByTestId("agent-row-claude")).toBeInTheDocument();
    });
  });

  it("renders all catalog agent rows", async () => {
    render(<AgentsSection />);
    // agent rows for all catalog entries should be present
    await waitFor(() => {
      expect(screen.getByTestId("agent-row-claude")).toBeInTheDocument();
      expect(screen.getByTestId("agent-row-codex")).toBeInTheDocument();
    });
  });

  it("sorts detected agent rows before missing rows", async () => {
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: makePierMock(["codex"]),
    });

    render(<AgentsSection />);

    await waitFor(() => {
      expect(screen.getAllByRole("listitem")[0]).toHaveAttribute(
        "data-testid",
        "agent-row-codex"
      );
    });
  });

  it("shows detected badge for claude after detect", async () => {
    render(<AgentsSection />);
    await waitFor(() => {
      expect(useAgentDetectStore.getState().detectedIds).toContain("claude");
    });
    useAgentPreferencesStore.setState(DEFAULT_PREFERENCES);
    // Re-render to pick up store state
    cleanup();
    useAgentDetectStore.setState({ detectedIds: ["claude"] });
    render(<AgentsSection />);
    const claudeRow = screen.getByTestId("agent-row-claude");
    expect(claudeRow.textContent).toContain("Detected");
  });

  it("expanding agent-row-claude shows launchCmd", async () => {
    useAgentDetectStore.setState({ detectedIds: ["claude"] });
    render(<AgentsSection />);
    const claudeRow = screen.getByTestId("agent-row-claude");
    const expandBtn = claudeRow.querySelector(
      'button[aria-label="Details"]'
    ) as HTMLButtonElement;
    expect(expandBtn).not.toBeNull();
    fireEvent.click(expandBtn);
    await waitFor(() => {
      // launchCmd label visible in expanded details
      expect(screen.getByText("Launch command")).toBeInTheDocument();
      // the actual launchCmd value from catalog
      expect(screen.getAllByText("claude").length).toBeGreaterThan(0);
    });
  });

  it("expanded agent details show effective launch args from the global permission mode", async () => {
    useAgentDetectStore.setState({ detectedIds: ["codex"] });
    useAgentPreferencesStore.setState({
      ...DEFAULT_PREFERENCES,
      agentPermissionMode: "yolo",
      agentDefaultArgs: {},
    });
    render(<AgentsSection />);
    const codexRow = screen.getByTestId("agent-row-codex");
    const expandBtn = codexRow.querySelector(
      'button[aria-label="Details"]'
    ) as HTMLButtonElement;
    fireEvent.click(expandBtn);
    await waitFor(() => {
      expect(screen.getByLabelText("Launch args")).toHaveValue(
        "--dangerously-bypass-approvals-and-sandbox"
      );
    });
  });

  it("Blank chip sets defaultAgentId to blank", async () => {
    render(<AgentsSection />);
    const blankBtn = screen.getByRole("radio", { name: "Blank terminal" });
    fireEvent.click(blankBtn);
    await waitFor(() => {
      expect(window.pier.preferences.update).toHaveBeenCalledWith(
        expect.objectContaining({ defaultAgentId: "blank" })
      );
    });
  });

  it("disable button for codex toggles disabledAgentIds", async () => {
    useAgentDetectStore.setState({ detectedIds: ["claude", "codex"] });
    render(<AgentsSection />);
    const codexRow = screen.getByTestId("agent-row-codex");
    const disableBtn = Array.from(codexRow.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Disable"
    );
    expect(disableBtn).toBeDefined();
    if (disableBtn) {
      fireEvent.click(disableBtn);
      await waitFor(() => {
        expect(window.pier.preferences.update).toHaveBeenCalledWith(
          expect.objectContaining({
            disabledAgentIds: expect.arrayContaining(["codex"]),
          })
        );
      });
    }
  });

  it("missing agent rows do not show stale default or enablement actions", async () => {
    useAgentPreferencesStore.setState({
      ...DEFAULT_PREFERENCES,
      defaultAgentId: "codex",
      disabledAgentIds: ["codex"],
    });

    render(<AgentsSection />);

    await waitFor(() => {
      expect(useAgentDetectStore.getState().detectedIds).toEqual(["claude"]);
    });

    const codexRow = screen.getByTestId("agent-row-codex");
    const codex = within(codexRow);
    expect(codex.getByText("Not installed")).toBeInTheDocument();
    expect(codex.queryByText("Default")).not.toBeInTheDocument();
    expect(
      codex.queryByRole("button", { name: "Details" })
    ).not.toBeInTheDocument();
    const websiteLink = codex.getByRole("link", { name: "Website" });
    expect(websiteLink).toHaveAttribute(
      "href",
      "https://github.com/openai/codex"
    );
    expect(websiteLink).not.toHaveAttribute("target");
    fireEvent.click(websiteLink);
    await waitFor(() => {
      expect(window.pier.externalNavigation.open).toHaveBeenCalledWith(
        "https://github.com/openai/codex"
      );
    });
    expect(
      codex.queryByRole("button", { name: "Set default" })
    ).not.toBeInTheDocument();
    expect(
      codex.queryByRole("button", { name: "Disable" })
    ).not.toBeInTheDocument();
    expect(
      codex.queryByRole("button", { name: "Enable" })
    ).not.toBeInTheDocument();
  });

  it("surfaces agent website failures in the app dialog", async () => {
    const pier = makePierMock(["claude"]);
    pier.externalNavigation.open.mockResolvedValue({
      opened: false,
      reason: "open-failed",
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: pier,
    });
    render(<AgentsSection />);
    const websiteLink = within(screen.getByTestId("agent-row-codex")).getByRole(
      "link",
      { name: "Website" }
    );

    fireEvent.click(websiteLink);

    await waitFor(() => {
      expect(appDialogMocks.showAppAlert).toHaveBeenCalledWith({
        body: "The agent website could not be opened.",
        size: "sm",
        title: "Unable to open website",
      });
    });
  });

  it("uses busy feedback when another external link is opening", async () => {
    const pier = makePierMock(["claude"]);
    pier.externalNavigation.open.mockResolvedValue({
      opened: false,
      reason: "busy",
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: pier,
    });
    render(<AgentsSection />);
    const websiteLink = within(screen.getByTestId("agent-row-codex")).getByRole(
      "link",
      { name: "Website" }
    );

    fireEvent.click(websiteLink);

    await waitFor(() => {
      expect(toastMocks.info).toHaveBeenCalledWith(
        "Another link is already opening"
      );
    });
    expect(appDialogMocks.showAppAlert).not.toHaveBeenCalled();
  });

  it("Refresh button spins the refresh icon and toasts on success", async () => {
    let resolveRefresh: (() => void) | undefined;
    const refreshSpy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
          useAgentDetectStore.setState({ isRefreshing: true });
        })
    );
    useAgentDetectStore.setState({ refresh: refreshSpy } as never);

    render(<AgentsSection />);
    const refreshBtn = screen.getByRole("button", { name: "Refresh" });
    fireEvent.click(refreshBtn);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(refreshBtn).toBeDisabled();
    });
    const icon = refreshBtn.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass("animate-spin");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    useAgentDetectStore.setState({ isRefreshing: false });
    resolveRefresh?.();

    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalledWith("List refreshed");
    });
    expect(appDialogMocks.showAppAlert).not.toHaveBeenCalled();
  });

  it("Refresh failure surfaces a detailed app alert", async () => {
    const refreshSpy = vi.fn(async () => {
      throw new Error("detect service down");
    });
    useAgentDetectStore.setState({ refresh: refreshSpy } as never);

    render(<AgentsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(appDialogMocks.showAppAlert).toHaveBeenCalledWith({
        body: "detect service down",
        title: "Couldn't refresh list",
      });
    });
    expect(toastMocks.success).not.toHaveBeenCalled();
  });

  it("PermissionModeRow shows the manual select value by default", () => {
    useAgentPreferencesStore.setState({
      ...DEFAULT_PREFERENCES,
      agentDefaultArgs: {},
    });
    render(<AgentsSection />);
    // empty args → resolvePermissionMode = "manual" → a select (combobox)
    // renders, not the read-only Mixed badge.
    const combobox = screen.getByRole("combobox", { name: "Permission Mode" });
    expect(combobox).toHaveTextContent("Manual");
    expect(screen.queryByText("Mixed")).not.toBeInTheDocument();
  });

  it("PermissionModeRow keeps the persisted yolo select even when per-agent args are custom", () => {
    useAgentPreferencesStore.setState({
      ...DEFAULT_PREFERENCES,
      agentPermissionMode: "yolo",
      agentDefaultArgs: { claude: "--some-custom-flag" },
    });
    render(<AgentsSection />);
    const combobox = screen.getByRole("combobox", { name: "Permission Mode" });
    expect(combobox).toHaveTextContent("Skip prompts");
    expect(screen.queryByText("Mixed")).not.toBeInTheDocument();
  });

  it("PermissionModeRow keeps the persisted manual select when goose env is present", () => {
    useAgentPreferencesStore.setState({
      ...DEFAULT_PREFERENCES,
      agentDefaultEnv: { goose: { GOOSE_MODE: "auto" } },
    });
    render(<AgentsSection />);
    const combobox = screen.getByRole("combobox", { name: "Permission Mode" });
    expect(combobox).toHaveTextContent("Manual");
    expect(screen.queryByText("Mixed")).not.toBeInTheDocument();
  });

  it("insets agent list dividers to the card content gutter", async () => {
    const { container } = render(<AgentsSection />);

    await waitFor(() => {
      expect(screen.getByTestId("agent-row-codex")).toBeInTheDocument();
    });

    const separators = container.querySelectorAll(
      '[data-slot="item-separator"]'
    );
    expect(separators.length).toBeGreaterThan(0);
    for (const separator of separators) {
      expect(separator).toHaveClass(
        "mx-(--card-spacing)",
        "data-horizontal:w-auto"
      );
      expect(separator).not.toHaveClass("data-horizontal:w-full");
    }
  });
});
