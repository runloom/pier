import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { MemorySettingsDetail } from "@plugins/builtin/memory/renderer/settings-detail.tsx";
import type { MemoryStatusSnapshot } from "@shared/contracts/agent/memory.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const root = { projectRootPath: "/repo", scope: "project" as const };

function snapshot(
  patch: Partial<MemoryStatusSnapshot> = {}
): MemoryStatusSnapshot {
  return {
    derivedState: "disabled",
    desiredState: "disabled",
    enginePackage: "@modelcontextprotocol/server-memory@2026.7.4",
    entityCount: 0,
    observationCount: 0,
    storePath: "/tmp/memory.jsonl",
    storePathDisplay: "~/display/memory.jsonl",
    targets: [],
    ...patch,
  };
}

function makeContext() {
  const enable = vi.fn();
  const disable = vi.fn();
  const status = vi.fn();
  const list = vi.fn();
  const deleteObservation = vi.fn();
  const clearStore = vi.fn();
  const openInEditor = vi.fn();
  const closeSettings = vi.fn();
  const confirm = vi.fn();
  const alert = vi.fn();
  const t = (
    key: string,
    values?: Record<string, number | string>,
    fallback?: string
  ) => {
    if (key === "summary.connected" && values?.count != null) {
      return `Connected for ${values.count} agents`;
    }
    return fallback ?? key;
  };
  const context = {
    dialogs: { alert, confirm },
    files: { openInEditor },
    i18n: { t },
    panels: { getActiveContext: () => ({ projectRootPath: "/repo" }) },
    projectMemory: {
      clearStore,
      deleteObservation,
      disable,
      enable,
      list,
      status,
    },
    settings: { close: closeSettings },
  } as unknown as RendererPluginContext;
  return {
    alert,
    closeSettings,
    confirm,
    context,
    deleteObservation,
    enable,
    list,
    openInEditor,
    status,
  };
}

describe("pier.memory project settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the enable switch for the host-selected project", async () => {
    const { context, list, status } = makeContext();
    status.mockResolvedValue(snapshot());
    list.mockResolvedValue({ items: [], tooLarge: false });
    render(
      createElement(MemorySettingsDetail, {
        context,
        projectRootPath: "/repo",
      })
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Enable project memory")).toBeTruthy();
    });
    expect(status).toHaveBeenCalledWith(root);
  });

  it("shows the store path and opens it inside Pier on click", async () => {
    const { closeSettings, context, list, openInEditor, status } =
      makeContext();
    status.mockResolvedValue(snapshot());
    list.mockResolvedValue({ items: [], tooLarge: false });
    openInEditor.mockReturnValue(true);
    render(
      createElement(MemorySettingsDetail, {
        context,
        projectRootPath: "/repo",
      })
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Open memory file in Pier")).toBeTruthy();
    });
    const pathButton = screen.getByLabelText("Open memory file in Pier");
    // 展示 `~` 折叠路径,点击仍用绝对路径打开。
    expect(pathButton.textContent).toContain("~/display/memory.jsonl");
    fireEvent.click(pathButton);
    expect(openInEditor).toHaveBeenCalledWith({
      path: "memory.jsonl",
      root: "/tmp",
    });
    expect(closeSettings).toHaveBeenCalled();
  });

  it("deletes an observation after confirm", async () => {
    const { confirm, context, deleteObservation, list, status } = makeContext();
    status.mockResolvedValue(
      snapshot({
        derivedState: "enabled",
        desiredState: "enabled",
        entityCount: 1,
        observationCount: 1,
      })
    );
    list.mockResolvedValue({
      items: [
        {
          entityName: "pnpm",
          entityType: "convention",
          index: 0,
          observation: "use pnpm",
        },
      ],
      tooLarge: false,
    });
    confirm.mockResolvedValue(true);
    deleteObservation.mockResolvedValue(undefined);
    render(
      createElement(MemorySettingsDetail, {
        context,
        projectRootPath: "/repo",
      })
    );
    await waitFor(() => {
      expect(screen.getByText("use pnpm")).toBeTruthy();
    });
    expect(screen.getByText("pnpm · convention").className).toContain(
      "text-xs"
    );
    expect(
      screen.getByRole("button", { name: "Clear project memory" }).className
    ).toContain("self-start");
    fireEvent.click(screen.getByLabelText("Delete this memory"));
    await waitFor(() => {
      expect(deleteObservation).toHaveBeenCalledWith(
        root,
        "pnpm",
        0,
        "use pnpm"
      );
    });
    expect(confirm).toHaveBeenCalled();
  });

  it("shows degraded details without toast", async () => {
    const { alert, context, list, status } = makeContext();
    status.mockResolvedValue(
      snapshot({
        derivedState: "degraded",
        desiredState: "enabled",
        targets: [
          {
            configPath: "/repo/.mcp.json",
            consumers: ["claude"],
            detail: "conflict",
            outcome: "failed",
          },
        ],
      })
    );
    list.mockResolvedValue({ items: [], tooLarge: false });
    render(
      createElement(MemorySettingsDetail, {
        context,
        projectRootPath: "/repo",
      })
    );
    await waitFor(() => {
      expect(screen.getByText("Some agents are not connected.")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("View details"));
    await waitFor(() => {
      expect(alert).toHaveBeenCalled();
    });
    const body = String(
      (alert.mock.calls[0] as [{ body: string }] | undefined)?.[0]?.body ?? ""
    );
    expect(body).toContain("/repo/.mcp.json");
    expect(body).toContain("conflict");
    expect(body).not.toContain("written");
  });

  it("enables directly without any git confirmation dialog", async () => {
    const { confirm, context, enable, list, status } = makeContext();
    status.mockResolvedValue(snapshot());
    list.mockResolvedValue({ items: [], tooLarge: false });
    enable.mockResolvedValue({ kind: "report", state: "enabled", targets: [] });
    render(
      createElement(MemorySettingsDetail, {
        context,
        projectRootPath: "/repo",
      })
    );
    // 快照未到前开关禁点(防误触写成显式决策);等它可用再点。
    await waitFor(() => {
      const toggle = screen.getByLabelText(
        "Enable project memory"
      ) as HTMLButtonElement;
      expect(toggle.disabled).toBe(false);
    });
    fireEvent.click(screen.getByLabelText("Enable project memory"));
    await waitFor(() => {
      expect(enable).toHaveBeenCalledWith(root);
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("stacks setting cards with gap", async () => {
    const { context, list, status } = makeContext();
    status.mockResolvedValue(snapshot());
    list.mockResolvedValue({ items: [], tooLarge: false });
    const { container } = render(
      createElement(MemorySettingsDetail, {
        context,
        projectRootPath: "/repo",
      })
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Enable project memory")).toBeTruthy();
    });
    expect(
      container.querySelector("[data-slot='memory-project-settings']")
    ).toBeTruthy();
  });
});
