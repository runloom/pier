import type { AgentLifecycleProbe } from "@shared/contracts/agent/lifecycle.ts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { AgentExpandedDetails } from "@/pages/settings/components/agent-row-details.tsx";
import { useAgentLifecycleStore } from "@/stores/agent-lifecycle.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";

const HINT =
  "Pi’s current settings hide its status from Pier. Run pi config to turn it back on.";

function probe(patch: Partial<AgentLifecycleProbe> = {}): AgentLifecycleProbe {
  return {
    agentId: "pi",
    canInstall: true,
    canUninstall: false,
    detected: true,
    installedButBroken: false,
    installs: [],
    isConflict: false,
    latestVersion: null,
    support: "full",
    uninstallMode: "none",
    updateAvailable: false,
    updateMode: "versioned",
    updateOffered: false,
    version: "1.2.3",
    ...patch,
  };
}

describe("AgentExpandedDetails status-hook diagnostic", () => {
  beforeEach(async () => {
    await initI18n();
    useAgentPreferencesStore.setState({
      agentCommandOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      agentPermissionMode: "manual",
      agentStatusHooks: true,
      defaultAgentId: null,
      disabledAgentIds: [],
    });
    useAgentLifecycleStore.setState({ probesById: {} });
  });

  afterEach(cleanup);

  it("shows the hint when the agent config hides the status feed", () => {
    useAgentLifecycleStore.setState({
      probesById: { pi: probe({ statusHooksDisabledByConfig: true }) },
    });

    render(<AgentExpandedDetails agentId="pi" />);

    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it("stays quiet when the status feed is enabled", () => {
    useAgentLifecycleStore.setState({ probesById: { pi: probe() } });

    render(<AgentExpandedDetails agentId="pi" />);

    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });
});
