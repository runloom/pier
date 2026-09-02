import { describe, expect, it } from "vitest";
import { parseGitHubRepo } from "../../../../packages/plugin-tasks/src/main/prefs.ts";
import {
  mapIssue,
  shapeBoard,
} from "../../../../packages/plugin-tasks/src/main/providers/github-map.ts";
import { parseIssueKey } from "../../../../packages/plugin-tasks/src/shared/rpc.ts";

describe("github mapping", () => {
  it("parses remotes and issue keys", () => {
    expect(parseGitHubRepo("git@github.com:acme/app.git")).toBe("acme/app");
    expect(parseGitHubRepo("https://github.com/acme/app")).toBe("acme/app");
    expect(parseIssueKey("acme/app#12")).toEqual({
      number: 12,
      owner: "acme",
      repo: "app",
    });
  });

  it("counts open blockers and linked pull requests", () => {
    const card = mapIssue(
      {
        assignees: { nodes: [{ login: "ada" }] },
        blockedBy: {
          nodes: [
            {
              closed: false,
              number: 2,
              repository: { nameWithOwner: "acme/app" },
              title: "Blocker",
              url: "https://example.test/2",
            },
          ],
        },
        closed: false,
        closedByPullRequestsReferences: {
          nodes: [
            {
              merged: true,
              number: 9,
              state: "MERGED",
              title: "Fix",
              url: "https://example.test/pr/9",
            },
          ],
        },
        number: 1,
        repository: { nameWithOwner: "acme/app", viewerPermission: "WRITE" },
        title: "Ship",
        url: "https://example.test/1",
      },
      "acme/app"
    );
    expect(card.openBlockedByCount).toBe(1);
    expect(
      mapIssue(
        {
          closed: false,
          labels: { nodes: [{ name: "blocked-by:#9" }] },
          number: 3,
          repository: { nameWithOwner: "acme/app" },
          title: "Follow-up",
          url: "https://example.test/3",
        },
        "acme/app"
      ).blockers
    ).toEqual([
      expect.objectContaining({ key: "acme/app#9", repo: "acme/app" }),
    ]);
    const projectBoard = shapeBoard(
      { projectId: "PVT_1", repo: "acme/app" },
      [
        {
          assignees: { nodes: [{ login: "ada" }] },
          closed: false,
          number: 1,
          repository: { nameWithOwner: "acme/app" },
          title: "Ship",
          url: "https://example.test/1",
        },
      ],
      true,
      { columnByKey: new Map([["acme/app#1", "todo"]]) }
    );
    expect(projectBoard.columnMapping).toBe("project");
    expect(
      projectBoard.columns.find((column) => column.id === "todo")?.items
    ).toHaveLength(1);
    expect(card.linkedPRs).toEqual([
      expect.objectContaining({ merged: true, number: 9 }),
    ]);
    const board = shapeBoard(
      { repo: "acme/app" },
      [
        {
          assignees: { nodes: [{ login: "ada" }] },
          closed: false,
          number: 1,
          repository: { nameWithOwner: "acme/app", viewerPermission: "WRITE" },
          title: "Ship",
          url: "https://example.test/1",
        },
      ],
      true
    );
    expect(board.canWrite).toBe(true);
    expect(
      board.columns.find((column) => column.id === "inProgress")?.items
    ).toHaveLength(1);
    expect(board.columns.find((column) => column.id === "done")?.readonly).toBe(
      true
    );
  });
});
