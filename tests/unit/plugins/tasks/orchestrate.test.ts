import { describe, expect, it } from "vitest";
import { orchestrateStartWork } from "../../../../packages/plugin-tasks/src/renderer/orchestrate.ts";

describe("start-work orchestration", () => {
  it("rolls back a created tree when the terminal fails", async () => {
    const removed: string[] = [];
    await expect(
      orchestrateStartWork(
        {
          check: async () => ({ mainPath: "/repo", status: "supported" }),
          create: async () => ({ targetPath: "/repo/.worktrees/task-1" }),
          openTerminal: async () => {
            throw new Error("terminal failed");
          },
          recordOverlay: async () => undefined,
          remove: async ({ path }) => {
            removed.push(path);
          },
        },
        {
          itemKey: "acme/app#1",
          number: 1,
          projectRootPath: "/repo",
          repo: "acme/app",
        }
      )
    ).rejects.toThrow("terminal failed");
    expect(removed).toEqual(["/repo/.worktrees/task-1"]);
  });

  it("records overlay after both tree and terminal succeed", async () => {
    const recorded: string[] = [];
    const result = await orchestrateStartWork(
      {
        check: async () => ({ mainPath: "/repo", status: "supported" }),
        create: async () => ({ targetPath: "/repo/.worktrees/task-1" }),
        openTerminal: async () => ({ panelId: "p1" }),
        recordOverlay: async (overlay) => {
          recorded.push(overlay.itemKey);
        },
        remove: async () => undefined,
      },
      {
        itemKey: "acme/app#1",
        number: 1,
        projectRootPath: "/repo",
        repo: "acme/app",
      }
    );
    expect(result.overlayRecorded).toBe(true);
    expect(recorded).toEqual(["acme/app#1"]);
  });
});
