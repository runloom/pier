// @vitest-environment jsdom
import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createTaskBoardPanel } from "../../../../packages/plugin-tasks/src/renderer/board-panel.tsx";
import type { SourceStatus } from "../../../../packages/plugin-tasks/src/shared/types.ts";

const status: SourceStatus = {
  credential: {
    authorized: true,
    jiraAuthorized: false,
    jiraBaseUrl: null,
    linearAuthorized: false,
    linearProbed: false,
    login: "ada",
    probed: true,
  },
  githubRepo: "acme/app",
  jiraProjectKeys: [],
  lastJiraProject: null,
  lastLinearProject: null,
  lastLinearTeam: null,
  lastSource: "github",
  linearTeamKeys: [],
};

function mockContext(
  nextStatus: SourceStatus = status
): ExternalRendererPluginContext {
  return {
    applets: {
      render: () => <div data-testid="task-applet">applet</div>,
    },
    dialogs: {
      alert: async () => undefined,
    },
    i18n: {
      t: (_key: string, fallback?: string) => fallback ?? _key,
    },
    rpc: {
      invoke: async (method: string) => {
        if (method === "source.status") {
          return nextStatus;
        }
        return {};
      },
      on: () => () => undefined,
    },
  } as unknown as ExternalRendererPluginContext;
}

describe("task board panel", () => {
  it("renders header chrome and the board body without crashing", async () => {
    const Panel = createTaskBoardPanel(mockContext());
    render(
      <Panel
        params={{
          context: { projectRootPath: "/repo" },
        }}
      />
    );
    expect(screen.getByLabelText("Tracker")).toBeTruthy();
    expect(screen.getByLabelText("Switch to list")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("task-applet")).toBeTruthy();
    });
  });

  it("hides team filters while Linear still needs a token", async () => {
    const Panel = createTaskBoardPanel(
      mockContext({
        ...status,
        lastSource: "linear",
        lastLinearTeam: "FL",
        linearTeamKeys: ["FL"],
      })
    );
    render(
      <Panel
        params={{
          context: { projectRootPath: "/repo" },
        }}
      />
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Tracker")).toBeTruthy();
    });
    expect(screen.queryByLabelText("Linear team")).toBeNull();
    expect(screen.getByText("Connect Linear to load issues")).toBeTruthy();
  });
});
