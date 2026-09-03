import type { McpServerView } from "@shared/contracts/agent/assets.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  clearPluginProjectSettingsForTests,
  registerPluginProjectSettings,
} from "@/lib/plugins/project-settings-registry.ts";
import { ProjectMcpPanel } from "@/pages/settings/components/project/mcp-panel.tsx";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

const catalog = vi.fn();
const shellPathMocks = vi.hoisted(() => ({
  openAbsoluteInPierEditor: vi.fn(() => ({ ok: true as const })),
  openUnderRootInPierEditor: vi.fn(() => ({ ok: true as const })),
}));

vi.mock("@/lib/files/shell-path-actions.ts", () => shellPathMocks);

function listing(
  overrides: Partial<McpServerView["listings"][number]> & {
    agentId: string;
  }
): McpServerView["listings"][number] {
  return {
    absolutePath: "/tmp/mcp.json",
    agentLabel: overrides.agentId,
    displayPath: ".cursor/mcp.json",
    enabled: true,
    entryId: "project-.cursor-mcp.json",
    scopeLabel: "project",
    transport: "stdio",
    ...overrides,
  };
}

const grokFilesystem: McpServerView = {
  enabled: "on",
  effects: [
    {
      agentKind: "grok",
      effect: { state: "discoverable", viaRoot: "~/.grok/config.toml" },
    },
  ],
  gaps: [{ agentKind: "claude" }],
  listings: [
    listing({
      agentId: "grok",
      displayPath: "~/.grok/config.toml",
      scopeLabel: "user",
    }),
  ],
  name: "filesystem",
  ownership: "user",
  transport: "stdio",
};

const pierMemory: McpServerView = {
  enabled: "on",
  effects: [
    {
      agentKind: "grok",
      effect: { state: "discoverable", viaRoot: "~/.grok/config.toml" },
    },
  ],
  gaps: [],
  listings: [
    listing({
      agentId: "grok",
      displayPath: "~/.grok/config.toml",
      scopeLabel: "user",
    }),
  ],
  name: "pier-memory",
  ownership: "pier-managed",
  transport: "stdio",
};

describe("ProjectMcpPanel inventory", () => {
  beforeEach(async () => {
    await initI18n();
    await i18next.changeLanguage("zh-CN");
    catalog.mockReset();
    shellPathMocks.openAbsoluteInPierEditor.mockReset();
    shellPathMocks.openUnderRootInPierEditor.mockReset();
    shellPathMocks.openAbsoluteInPierEditor.mockReturnValue({ ok: true });
    shellPathMocks.openUnderRootInPierEditor.mockReturnValue({ ok: true });
    window.pier = {
      agentAssets: { mcp: { catalog } },
    } as never;
    useSettingsDialogStore.getState().setProjectsTab("mcp");
    clearPluginProjectSettingsForTests();
    registerPluginProjectSettings({
      id: "pier.memory.project",
      render: () => null,
      title: () => "项目记忆",
      visible: ({ isPierHome }) => !isPierHome,
    });
  });

  afterEach(() => {
    cleanup();
    clearPluginProjectSettingsForTests();
  });

  it("shows groups, Grok by name, and jumps to project memory", async () => {
    catalog.mockResolvedValue({
      entries: [],
      scope: "project",
      servers: [pierMemory, grokFilesystem],
    });
    render(<ProjectMcpPanel isPierHome={false} projectRootPath="/repo" />);
    await waitFor(() => {
      expect(screen.getByText("项目记忆")).toBeTruthy();
    });
    expect(screen.getAllByText("Pier 托管").length).toBeGreaterThan(0);
    expect(screen.getAllByText("用户配置").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Grok").length).toBeGreaterThan(0);
    expect(screen.getAllByText("~/.grok/config.toml").length).toBeGreaterThan(
      0
    );
    expect(screen.getByText("未接入 Claude")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "打开项目记忆" }));
    expect(useSettingsDialogStore.getState().projectsTab).toBe(
      "pier.memory.project"
    );
  });

  it("opens config for pier-memory on Pier Home", async () => {
    catalog.mockResolvedValue({
      entries: [],
      scope: "home",
      servers: [pierMemory],
    });
    render(<ProjectMcpPanel isPierHome projectRootPath="/home-root" />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "打开配置文件" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "打开项目记忆" })).toBeNull();
  });

  it("opens nested project configs on the repository tree", async () => {
    const cursorGithub: McpServerView = {
      enabled: "on",
      effects: [
        {
          agentKind: "cursor",
          effect: { state: "discoverable", viaRoot: ".cursor/mcp.json" },
        },
      ],
      gaps: [],
      listings: [
        listing({
          absolutePath: "/repo/.cursor/mcp.json",
          agentId: "cursor",
          displayPath: ".cursor/mcp.json",
          scopeLabel: "project",
        }),
      ],
      name: "github",
      ownership: "project",
      transport: "stdio",
    };
    catalog.mockResolvedValue({
      entries: [],
      scope: "project",
      servers: [cursorGithub],
    });
    render(<ProjectMcpPanel isPierHome={false} projectRootPath="/repo" />);
    await waitFor(() => {
      expect(screen.getByText(".cursor/mcp.json")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "打开配置文件" }));
    expect(shellPathMocks.openUnderRootInPierEditor).toHaveBeenCalledWith(
      "/repo",
      ".cursor/mcp.json"
    );
    expect(shellPathMocks.openAbsoluteInPierEditor).not.toHaveBeenCalled();
  });
});
