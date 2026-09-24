import { terminalSessionStateSchema } from "@main/state/terminal-session-state-schemas.ts";
import { describe, expect, it } from "vitest";

function task(source: string) {
  return {
    cwd: "/repo",
    label: source,
    projectRootPath: "/repo",
    rawCommand: "echo ok",
    runId: `run-${source}`,
    source,
    startedAt: 1,
    status: "running",
    taskId: `${source}:task`,
  };
}

describe("terminal session retired zed tasks", () => {
  it("drops zed task metadata and keeps the rest of the session", () => {
    const parsed = terminalSessionStateSchema.parse({
      version: 1,
      windows: {
        main: {
          panels: {
            kept: {
              task: task("vscode"),
              updatedAt: "2026-09-23T00:00:00.000Z",
            },
            retired: {
              task: task("zed"),
              updatedAt: "2026-09-23T00:00:00.000Z",
            },
          },
        },
      },
    });

    expect(parsed.windows.main?.panels.kept?.task?.source).toBe("vscode");
    expect(parsed.windows.main?.panels.retired?.task).toBeUndefined();
    expect(parsed.windows.main?.panels.retired?.updatedAt).toBe(
      "2026-09-23T00:00:00.000Z"
    );
  });
});
