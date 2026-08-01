import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPierHomeService } from "@main/services/pier-home/service.ts";
import { resolveStableProjectIdentity } from "@main/services/project-skills/identity.ts";
import { createProjectSkillsPaths } from "@main/services/project-skills/paths.ts";
import { createPierBindingsConverge } from "@main/services/project-skills/pier-bindings/converge.ts";
import { createPierBindingsChannel } from "@main/services/project-skills/pier-bindings/index.ts";
import { createProjectSkillsStore } from "@main/services/project-skills/store/index.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("pierBindings converge", () => {
  let userData: string;
  let projectRoot: string;

  beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), "pier-converge-ud-"));
    projectRoot = await mkdtemp(join(tmpdir(), "pier-converge-proj-"));
  });

  afterEach(async () => {
    await Promise.all(
      [userData, projectRoot].map((dir) =>
        rm(dir, { force: true, recursive: true })
      )
    );
  });

  it("aggregates ensureReady failures without aborting other projects", async () => {
    const home = createPierHomeService({ userDataPath: userData });
    await home.ensure();
    await home.skills.create({ skillId: "shared", description: "S" });

    const store = createProjectSkillsStore({ userData });
    const pierBindings = createPierBindingsChannel({
      userData,
      store,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () =>
        (await home.skills.list()).map((skill) => skill.id),
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    await pierBindings.bind({ rootKey, skillId: "shared" });

    let calls = 0;
    const converge = createPierBindingsConverge({
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listKnownProjectRoots: async () => [{ realPath: projectRoot }],
      paths,
      pierBindings,
      store,
      repairService: {
        ensureReady: async () => {
          calls += 1;
          if (calls === 1) {
            throw new Error("boom");
          }
          return {
            status: "ready",
            launchAttemptId: "x",
            repaired: false,
          } as never;
        },
      } as never,
    });

    const result = await converge.converge({
      kind: "skill",
      skillId: "shared",
    });
    expect(result.failed).toEqual([
      expect.objectContaining({ rootKey, message: "boom" }),
    ]);
    expect(result.converged).toEqual([]);
  });

  it("treats ensureReady blocked as converge failure", async () => {
    const home = createPierHomeService({ userDataPath: userData });
    await home.ensure();
    await home.skills.create({ skillId: "shared", description: "S" });
    const store = createProjectSkillsStore({ userData });
    const pierBindings = createPierBindingsChannel({
      userData,
      store,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () =>
        (await home.skills.list()).map((skill) => skill.id),
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    await pierBindings.bind({ rootKey, skillId: "shared" });

    const converge = createPierBindingsConverge({
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listKnownProjectRoots: async () => [{ realPath: projectRoot }],
      paths,
      pierBindings,
      store,
      repairService: {
        ensureReady: async () => ({
          status: "blocked",
          launchAttemptId: "x",
          issueSummary: [{ code: "projection-missing" }],
          degradePolicySummary: "allowed",
          expiresAt: Date.now() + 1,
        }),
      } as never,
    });

    const result = await converge.converge({
      kind: "skill",
      skillId: "shared",
    });
    expect(result.converged).toEqual([]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        rootKey,
        message: expect.stringContaining("projection-missing"),
      }),
    ]);
  });

  it("all-known-projects visits every known root", async () => {
    const home = createPierHomeService({ userDataPath: userData });
    await home.ensure();
    const store = createProjectSkillsStore({ userData });
    const pierBindings = createPierBindingsChannel({
      userData,
      store,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () => [],
    });
    const paths = createProjectSkillsPaths(userData);
    const ensureReady = vi.fn(async () => ({
      status: "ready",
      launchAttemptId: "x",
      repaired: false,
    }));
    const converge = createPierBindingsConverge({
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listKnownProjectRoots: async () => [{ realPath: projectRoot }],
      paths,
      pierBindings,
      store,
      repairService: { ensureReady } as never,
    });

    const result = await converge.converge({ kind: "all-known-projects" });
    expect(ensureReady).toHaveBeenCalledOnce();
    expect(result.failed).toEqual([]);
    expect(result.converged).toHaveLength(1);
  });

  it("all-known-projects fails when no known roots exist", async () => {
    const home = createPierHomeService({ userDataPath: userData });
    await home.ensure();
    const store = createProjectSkillsStore({ userData });
    const pierBindings = createPierBindingsChannel({
      userData,
      store,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () => [],
    });
    const paths = createProjectSkillsPaths(userData);
    const ensureReady = vi.fn(async () => ({
      status: "ready",
      launchAttemptId: "x",
      repaired: false,
    }));
    const converge = createPierBindingsConverge({
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listKnownProjectRoots: async () => [],
      paths,
      pierBindings,
      store,
      repairService: { ensureReady } as never,
    });

    const result = await converge.converge({ kind: "all-known-projects" });
    expect(ensureReady).not.toHaveBeenCalled();
    expect(result.converged).toEqual([]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        rootKey: "(none)",
        message: expect.stringContaining("No known projects"),
      }),
    ]);
  });

  it("alwaysInclude skill with empty known roots fails instead of silent success", async () => {
    const home = createPierHomeService({ userDataPath: userData });
    await home.ensure();
    await home.skills.create({
      skillId: "always-on",
      description: "A",
      alwaysInclude: true,
    });
    const store = createProjectSkillsStore({ userData });
    const pierBindings = createPierBindingsChannel({
      userData,
      store,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () =>
        (await home.skills.list()).map((skill) => skill.id),
    });
    const paths = createProjectSkillsPaths(userData);
    const converge = createPierBindingsConverge({
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listKnownProjectRoots: async () => [],
      paths,
      pierBindings,
      store,
      repairService: {
        ensureReady: async () => ({
          status: "ready",
          launchAttemptId: "x",
          repaired: false,
        }),
      } as never,
    });

    const result = await converge.converge({
      kind: "skill",
      skillId: "always-on",
    });
    expect(result.failed).toEqual([
      expect.objectContaining({ rootKey: "(none)" }),
    ]);
  });
});
