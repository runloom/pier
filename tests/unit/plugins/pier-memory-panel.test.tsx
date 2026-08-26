import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { createMemoryPanel } from "@plugins/builtin/memory/renderer/panel.tsx";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type { MemoryStatusSnapshot } from "@shared/contracts/memory.ts";
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
    enginePackage: "@modelcontextprotocol/server-memory@0.6.3",
    entityCount: 0,
    observationCount: 0,
    storePath: "/store/memory.jsonl",
    targets: [],
    ...patch,
  };
}

const panelProps = {
  api: {},
  containerApi: {},
  params: { context: { projectRootPath: "/repo" } },
} as IDockviewPanelProps;

function makeContext() {
  const enable = vi.fn();
  const disable = vi.fn();
  const status = vi.fn();
  const confirm = vi.fn();
  const alert = vi.fn();
  const t = (
    key: string,
    values?: Record<string, number | string>,
    fallback?: string
  ) => {
    if (key === "summary.connected") {
      return `Connected for ${values?.count ?? 0} agents`;
    }
    return fallback ?? key;
  };
  const context = {
    dialogs: { alert, confirm },
    i18n: { t },
    projectMemory: { disable, enable, status },
  } as unknown as RendererPluginContext;
  return { alert, confirm, context, disable, enable, status };
}

describe("pier.memory panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads status and toggles enable through confirmation", async () => {
    const { confirm, context, enable, status } = makeContext();
    status.mockResolvedValue(snapshot());
    enable
      .mockResolvedValueOnce({
        kind: "needsConfirmation",
        trackedTargets: ["/.mcp.json"],
      })
      .mockResolvedValueOnce({
        kind: "report",
        state: "enabled",
        targets: [],
      });
    confirm.mockResolvedValue(true);
    status
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValue(
        snapshot({ derivedState: "enabled", desiredState: "enabled" })
      );

    const Panel = createMemoryPanel(context);
    render(createElement(Panel, panelProps));

    await waitFor(() => {
      expect(status).toHaveBeenCalledWith(root);
    });
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => {
      expect(enable).toHaveBeenCalledWith(root);
    });
    await waitFor(() => {
      expect(confirm).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(enable).toHaveBeenLastCalledWith(root, { acknowledged: true });
    });
  });

  it("shows degraded alert details without toast", async () => {
    const { alert, context, status } = makeContext();
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
    const Panel = createMemoryPanel(context);
    render(createElement(Panel, panelProps));
    await waitFor(() => {
      expect(screen.getByText("View details")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("View details"));
    await waitFor(() => {
      expect(alert).toHaveBeenCalled();
    });
  });
});
