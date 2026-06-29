import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { AgentsSection } from "@/pages/settings/components/agents-section.tsx";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";

const DEFAULT_PREFERENCES = {
  agentCommandOverrides: {},
  agentDefaultArgs: {},
  defaultAgentId: null,
  disabledAgentIds: [],
};

function makePierMock(detectedIds: string[] = []) {
  return {
    agents: {
      detect: vi.fn(async () => ({ detectedIds })),
      refresh: vi.fn(async () => ({ detectedIds })),
    },
    preferences: {
      read: vi.fn(async () => ({
        ...DEFAULT_PREFERENCES,
        theme: "system",
        stylePreset: "pierre",
        language: "system",
        terminalCursorStyle: "block",
        terminalCursorBlink: true,
        terminalScrollbackMb: 64,
        terminalPasteProtection: true,
        terminalNewCwdPolicy: "activeTerminal",
      })),
      update: vi.fn(async (patch: Record<string, unknown>) => ({
        ...DEFAULT_PREFERENCES,
        ...patch,
      })),
      onChanged: vi.fn(() => () => undefined),
    },
  };
}

describe("AgentsSection", () => {
  beforeEach(async () => {
    await initI18n();

    useAgentDetectStore.setState({ detectedIds: [], isRefreshing: false });
    useAgentPreferencesStore.setState(DEFAULT_PREFERENCES);

    Object.defineProperty(window, "pier", {
      configurable: true,
      value: makePierMock(["claude"]),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAgentDetectStore.setState({ detectedIds: [], isRefreshing: false });
    useAgentPreferencesStore.setState(DEFAULT_PREFERENCES);
  });

  it("renders the section heading", () => {
    render(<AgentsSection />);
    expect(screen.getByText("Agents")).toBeInTheDocument();
  });

  it("renders the Auto chip", () => {
    render(<AgentsSection />);
    const autoBtn = screen.getByRole("button", { name: "Auto" });
    expect(autoBtn).toBeInTheDocument();
  });

  it("Auto pressed and Blank not pressed when defaultAgentId is null", () => {
    useAgentPreferencesStore.setState({
      ...DEFAULT_PREFERENCES,
      defaultAgentId: null,
    });
    render(<AgentsSection />);
    expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      screen.getByRole("button", { name: "Blank terminal" })
    ).toHaveAttribute("aria-pressed", "false");
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
      screen.getByRole("button", { name: "Blank terminal" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute(
      "aria-pressed",
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

  it("Blank chip sets defaultAgentId to blank", async () => {
    render(<AgentsSection />);
    const blankBtn = screen.getByRole("button", { name: "Blank terminal" });
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
});
