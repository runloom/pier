import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSourcePrefsStore } from "../../../../packages/plugin-tasks/src/main/prefs.ts";
import {
  sourceBlockReason,
  sourceBoardParams,
} from "../../../../packages/plugin-tasks/src/shared/source.ts";
import type { SourceStatus } from "../../../../packages/plugin-tasks/src/shared/types.ts";

function credential(
  patch: Partial<SourceStatus["credential"]> = {}
): SourceStatus["credential"] {
  return {
    authorized: false,
    jiraAuthorized: false,
    jiraBaseUrl: null,
    linearAuthorized: false,
    linearProbed: false,
    login: null,
    probed: false,
    ...patch,
  };
}

describe("task source prefs", () => {
  it("migrates a legacy github binding to origin + last source", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-tasks-pref-"));
    const filePath = join(dir, "bindings.json");
    await writeFile(
      filePath,
      JSON.stringify({
        bindings: {
          "/repo": { repo: "acme/app", updatedAt: 1 },
        },
      })
    );
    const store = createSourcePrefsStore({
      detectRemote: async () => "acme/app",
      filePath,
    });
    expect(await store.get("/repo")).toMatchObject({
      githubRepo: "acme/app",
      lastSource: "github",
      linearTeamKeys: [],
    });
  });

  it("migrates a connection list into global Linear teams", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-tasks-pref-"));
    const filePath = join(dir, "bindings.json");
    await writeFile(
      filePath,
      JSON.stringify({
        projects: {
          "/repo": {
            connections: [
              { id: "g", provider: "github", repo: "acme/app", updatedAt: 1 },
              { id: "l", provider: "linear", repo: "ENG", updatedAt: 2 },
            ],
            defaultId: "l",
            originRepo: "acme/app",
          },
        },
      })
    );
    const store = createSourcePrefsStore({
      detectRemote: async () => "acme/app",
      filePath,
    });
    const snapshot = await store.get("/repo");
    expect(snapshot.linearTeamKeys).toEqual(["ENG"]);
    expect(snapshot.lastSource).toBe("github");
    expect(snapshot.lastLinearTeam).toBe("ENG");
    expect(snapshot.githubRepo).toBe("acme/app");
  });

  it("remembers the last source per project and aliases worktrees by origin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-tasks-pref-"));
    const store = createSourcePrefsStore({
      detectRemote: async () => "acme/app",
      filePath: join(dir, "bindings.json"),
    });
    await store.setLinearTeamKeys(["ENG"]);
    await store.setLastSource("/repo", "linear");
    await store.setLastLinearTeam("/repo.worktree/feat", "ENG");
    const listed = await store.get("/repo");
    const worktree = await store.get("/repo.worktree/feat");
    expect(listed.lastSource).toBe("linear");
    expect(listed.lastLinearTeam).toBe("ENG");
    expect(worktree.lastSource).toBe("linear");
    expect(await store.findProjectRootByOrigin("acme/app")).toBe("/repo");
  });

  it("resolves a canvas fallback to the last opened project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-tasks-pref-"));
    const store = createSourcePrefsStore({
      detectRemote: async (path) =>
        path === "/repo" || path === "" ? "acme/app" : null,
      filePath: join(dir, "bindings.json"),
    });
    await store.get("/repo");
    expect(store.lastTouchedPath()).toBe("/repo");
    expect(await store.get("")).toMatchObject({
      githubRepo: "acme/app",
      lastSource: "github",
    });
  });

  it("keeps Linear teams global across projects", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-tasks-pref-"));
    const store = createSourcePrefsStore({
      detectRemote: async () => null,
      filePath: join(dir, "bindings.json"),
    });
    await store.setLinearTeamKeys(["ENG", "DESIGN"]);
    expect((await store.get("/a")).linearTeamKeys).toEqual(["ENG", "DESIGN"]);
    expect((await store.get("/b")).linearTeamKeys).toEqual(["ENG", "DESIGN"]);
  });
});

describe("task source routing", () => {
  it("blocks GitHub without a remote or token, Linear without teams", () => {
    const base: SourceStatus = {
      credential: credential(),
      githubRepo: null,
      jiraProjectKeys: [],
      lastJiraProject: null,
      lastLinearProject: null,
      lastLinearTeam: null,
      lastSource: "github",
      linearTeamKeys: [],
    };
    expect(sourceBlockReason(base, "github")).toBe("github-no-remote");
    expect(
      sourceBlockReason({ ...base, githubRepo: "acme/app" }, "github")
    ).toBe("github-need-auth");
    expect(sourceBlockReason(base, "linear")).toBe("linear-need-auth");
    expect(
      sourceBlockReason(
        {
          ...base,
          credential: credential({ linearAuthorized: true }),
        },
        "linear"
      )
    ).toBe("linear-need-team");
    expect(
      sourceBoardParams({
        ...base,
        linearTeamKeys: ["ENG"],
        lastSource: "linear",
      })
    ).toEqual({ provider: "linear", repo: "ENG" });
    expect(
      sourceBoardParams({
        ...base,
        lastLinearProject: "proj-1",
        lastSource: "linear",
        linearTeamKeys: ["ENG"],
      })
    ).toEqual({
      projectId: "proj-1",
      provider: "linear",
      repo: "ENG",
    });
  });
});
