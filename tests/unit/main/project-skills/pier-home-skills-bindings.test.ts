import { lstat, mkdtemp, readFile, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPierHomeService } from "@main/services/pier-home/service.ts";
import { PierHomeSkillsError } from "@main/services/pier-home/skills-library.ts";
import { resolveStableProjectIdentity } from "@main/services/project-skills/identity.ts";
import { createProjectSkillsPaths } from "@main/services/project-skills/paths.ts";
import { createPierBindingsChannel } from "@main/services/project-skills/pier-bindings/index.ts";
import { createProjectSkillsStore } from "@main/services/project-skills/store/index.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Pier Home skills library + pierBindings", { timeout: 30_000 }, () => {
  let userData: string;
  let projectRoot: string;
  let now: number;

  beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), "pier-home-skills-ud-"));
    projectRoot = await mkdtemp(join(tmpdir(), "pier-home-skills-proj-"));
    now = 1_700_000_000_000;
  });

  afterEach(async () => {
    await Promise.all(
      [userData, projectRoot].map((dir) =>
        rm(dir, { force: true, recursive: true })
      )
    );
  });

  it("creates, reads, writes and deletes library skills", async () => {
    const home = createPierHomeService({
      userDataPath: userData,
      now: () => now,
    });
    await home.ensure();

    const created = await home.skills.create({
      skillId: "review-notes",
      description: "Review helper",
    });
    expect(created).toMatchObject({
      id: "review-notes",
      alwaysInclude: false,
      delivery: null,
      name: "review-notes",
    });

    await expect(
      home.skills.create({ skillId: "pier-canvas" })
    ).rejects.toBeInstanceOf(PierHomeSkillsError);

    const md = await home.skills.readSkillMd("review-notes");
    expect(md).toContain('name: "review-notes"');

    now = 1_700_000_000_100;
    const written = await home.skills.writeSkillMd(
      "review-notes",
      '---\nname: review-notes\ndescription: "Updated"\n---\n\nBody\n'
    );
    expect(written.description).toBe("Updated");
    expect(written.updatedAt).toBe(now);

    await home.skills.delete("review-notes");
    await expect(
      home.skills.readSkillMd("review-notes")
    ).rejects.toBeInstanceOf(PierHomeSkillsError);
  });

  it("binds a library skill into a project and publishes projection", async () => {
    const home = createPierHomeService({
      userDataPath: userData,
      now: () => now,
    });
    await home.ensure();
    await home.skills.create({
      skillId: "shared-flow",
      description: "Shared",
    });

    const store = createProjectSkillsStore({ userData });
    const channel = createPierBindingsChannel({
      userData,
      store,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () =>
        (await home.skills.list()).map((skill) => skill.id),
    });

    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);

    await channel.bind({ rootKey, skillId: "shared-flow" });
    const result = await channel.reconcile({
      projectIdentity: identity,
      rootKey,
    });
    expect(result.published).toContain("shared-flow");
    expect(result.desiredProjections).toEqual([
      {
        skillId: "shared-flow",
        relativeTarget: ".agents/skills/shared-flow",
        expectedRelativeLinkTarget: "../../.pier/skills/library/shared-flow",
      },
    ]);

    const librarySkill = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      "shared-flow",
      "SKILL.md"
    );
    expect(await readFile(librarySkill, "utf8")).toContain("shared-flow");
    const link = join(projectRoot, ".agents", "skills", "shared-flow");
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe("../../.pier/skills/library/shared-flow");

    await channel.unbind({ rootKey, skillId: "shared-flow" });
    const after = await channel.reconcile({
      projectIdentity: identity,
      rootKey,
    });
    expect(after.desiredProjections).toEqual([]);
  });

  it("alwaysInclude skills are desired without bind and cannot unbind", async () => {
    const home = createPierHomeService({
      userDataPath: userData,
      now: () => now,
    });
    await home.ensure();
    await home.skills.create({
      skillId: "always-on",
      description: "Always",
      alwaysInclude: true,
    });

    const channel = createPierBindingsChannel({
      userData,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () =>
        (await home.skills.list()).map((skill) => skill.id),
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);

    const views = await channel.views(rootKey);
    expect(views).toEqual([
      expect.objectContaining({
        id: "always-on",
        alwaysInclude: true,
        delivery: { agents: true, claude: false },
      }),
    ]);

    await expect(
      channel.unbind({ rootKey, skillId: "always-on" })
    ).rejects.toThrow(/always-included/);

    const result = await channel.reconcile({
      projectIdentity: identity,
      rootKey,
    });
    expect(result.published).toContain("always-on");
    // Default always-include delivery is agents-only.
    expect(result.desiredProjections).toEqual([
      {
        skillId: "always-on",
        relativeTarget: ".agents/skills/always-on",
        expectedRelativeLinkTarget: "../../.pier/skills/library/always-on",
      },
    ]);
  });

  it("alwaysInclude delivery projects agents and/or claude roots", async () => {
    const home = createPierHomeService({
      userDataPath: userData,
      now: () => now,
    });
    await home.ensure();
    await home.skills.create({
      skillId: "routed",
      description: "Routed",
    });
    await home.skills.setAlwaysInclude("routed", true, {
      agents: true,
      claude: true,
    });

    const channel = createPierBindingsChannel({
      userData,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () =>
        (await home.skills.list()).map((skill) => skill.id),
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);

    const result = await channel.reconcile({
      projectIdentity: identity,
      rootKey,
    });
    expect(result.desiredProjections).toEqual([
      {
        skillId: "routed",
        relativeTarget: ".agents/skills/routed",
        expectedRelativeLinkTarget: "../../.pier/skills/library/routed",
      },
      {
        skillId: "routed",
        relativeTarget: ".claude/skills/routed",
        expectedRelativeLinkTarget: "../../.pier/skills/library/routed",
      },
    ]);
    expect(
      (
        await lstat(join(projectRoot, ".agents", "skills", "routed"))
      ).isSymbolicLink()
    ).toBe(true);
    expect(
      (
        await lstat(join(projectRoot, ".claude", "skills", "routed"))
      ).isSymbolicLink()
    ).toBe(true);
  });

  it("delete cascades unbindEverywhere ledger rows", async () => {
    const home = createPierHomeService({
      userDataPath: userData,
      now: () => now,
    });
    await home.ensure();
    await home.skills.create({ skillId: "temp-skill", description: "T" });

    const channel = createPierBindingsChannel({
      userData,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () =>
        (await home.skills.list()).map((skill) => skill.id),
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    await channel.bind({ rootKey, skillId: "temp-skill" });
    expect(await channel.listBoundIds(rootKey)).toContain("temp-skill");

    expect(await channel.unbindEverywhere("temp-skill")).toBe(1);
    expect(await channel.listBoundIds(rootKey)).not.toContain("temp-skill");
  });

  it("setAlwaysInclude updates catalog lock state and delivery", async () => {
    const home = createPierHomeService({
      userDataPath: userData,
      now: () => now,
    });
    await home.ensure();
    await home.skills.create({
      skillId: "lock-me",
      description: "Toggle always include",
    });
    const on = await home.skills.setAlwaysInclude("lock-me", true, {
      agents: false,
      claude: true,
    });
    expect(on.alwaysInclude).toBe(true);
    expect(on.delivery).toEqual({ agents: false, claude: true });
    const listed = await home.skills.listAlwaysIncludeSkills();
    expect(listed).toEqual([
      { id: "lock-me", delivery: { agents: false, claude: true } },
    ]);
    const off = await home.skills.setAlwaysInclude("lock-me", false);
    expect(off.alwaysInclude).toBe(false);
    expect(off.delivery).toBeNull();
  });

  it("migrates v1 boundSkillIds ledger to v2 bindings with default delivery", async () => {
    const home = createPierHomeService({
      userDataPath: userData,
      now: () => now,
    });
    await home.ensure();
    await home.skills.create({ skillId: "legacy-bind", description: "L" });

    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    const ledgerPath = join(
      userData,
      "project-skills",
      rootKey,
      "pier-bindings.json"
    );
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(userData, "project-skills", rootKey), { recursive: true });
    await writeFile(
      ledgerPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          generation: 3,
          boundSkillIds: ["legacy-bind"],
          publishedContentDigestsBySkillId: {},
        },
        null,
        2
      )}\n`
    );

    const channel = createPierBindingsChannel({
      userData,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () =>
        (await home.skills.list()).map((skill) => skill.id),
    });
    const desired = await channel.readDesired(rootKey);
    expect(desired.schemaVersion).toBe(2);
    expect(desired.bindings).toEqual([
      {
        skillId: "legacy-bind",
        delivery: { agents: true, claude: false },
      },
    ]);
    const views = await channel.views(rootKey);
    expect(views[0]?.delivery).toEqual({ agents: true, claude: false });
  });

  it("manual bind stores per-bind delivery including Claude", async () => {
    const home = createPierHomeService({
      userDataPath: userData,
      now: () => now,
    });
    await home.ensure();
    await home.skills.create({ skillId: "dual-bind", description: "D" });

    const channel = createPierBindingsChannel({
      userData,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () =>
        (await home.skills.list()).map((skill) => skill.id),
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);

    await channel.bind({
      rootKey,
      skillId: "dual-bind",
      delivery: { agents: true, claude: true },
    });
    const result = await channel.reconcile({
      projectIdentity: identity,
      rootKey,
    });
    expect(
      result.desiredProjections.map((p) => p.relativeTarget).sort()
    ).toEqual([".agents/skills/dual-bind", ".claude/skills/dual-bind"].sort());
  });

  it("unbind reconcile retires Pier-published library copies", async () => {
    const home = createPierHomeService({
      userDataPath: userData,
      now: () => now,
    });
    await home.ensure();
    await home.skills.create({ skillId: "retire-me", description: "R" });

    const store = createProjectSkillsStore({ userData });
    const channel = createPierBindingsChannel({
      userData,
      store,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () =>
        (await home.skills.list()).map((skill) => skill.id),
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);

    await channel.bind({ rootKey, skillId: "retire-me" });
    await channel.reconcile({ projectIdentity: identity, rootKey });
    const libraryDir = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      "retire-me"
    );
    expect(await lstat(libraryDir)).toBeTruthy();

    await channel.unbind({ rootKey, skillId: "retire-me" });
    const after = await channel.reconcile({
      projectIdentity: identity,
      rootKey,
    });
    expect(after.retiredLibraryIds).toContain("retire-me");
    await expect(lstat(libraryDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects corrupt pier-bindings.json instead of wiping desired state", async () => {
    const home = createPierHomeService({
      userDataPath: userData,
      now: () => now,
    });
    await home.ensure();
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    const ledgerDir = join(userData, "project-skills", rootKey);
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(ledgerDir, { recursive: true });
    await writeFile(join(ledgerDir, "pier-bindings.json"), "{not-json", "utf8");

    const channel = createPierBindingsChannel({
      userData,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () => [],
    });
    await expect(channel.readDesired(rootKey)).rejects.toThrow(/corrupt/);
  });

  it("listLedgerRootKeys ignores junk entries without ledger markers", async () => {
    const home = createPierHomeService({
      userDataPath: userData,
      now: () => now,
    });
    await home.ensure();
    await home.skills.create({ skillId: "marked", description: "M" });
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(userData, "project-skills", "not-a-ledger"), {
      recursive: true,
    });
    await writeFile(join(userData, "project-skills", "stray.txt"), "x", "utf8");
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);
    const channel = createPierBindingsChannel({
      userData,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () =>
        (await home.skills.list()).map((skill) => skill.id),
    });
    await channel.bind({ rootKey, skillId: "marked" });
    const keys = await channel.listLedgerRootKeys();
    expect(keys).toEqual([rootKey]);
  });

  it("deleting alwaysInclude then reconcile retires project projections", async () => {
    const home = createPierHomeService({
      userDataPath: userData,
      now: () => now,
    });
    await home.ensure();
    await home.skills.create({
      skillId: "vanish",
      description: "V",
      alwaysInclude: true,
      delivery: { agents: true, claude: false },
    });

    const store = createProjectSkillsStore({ userData });
    const channel = createPierBindingsChannel({
      userData,
      store,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () =>
        (await home.skills.list()).map((skill) => skill.id),
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);

    await channel.reconcile({ projectIdentity: identity, rootKey });
    const libraryDir = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      "vanish"
    );
    const linkPath = join(projectRoot, ".agents", "skills", "vanish");
    expect(await lstat(libraryDir)).toBeTruthy();
    expect(await readlink(linkPath)).toBe("../../.pier/skills/library/vanish");

    // Product delete order: remove catalog first, then reconcile tear-down.
    await home.skills.delete("vanish");
    const after = await channel.reconcile({
      projectIdentity: identity,
      rootKey,
    });
    expect(after.retiredLibraryIds).toContain("vanish");
    await expect(lstat(libraryDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("wrong existing symlink is left for repair but still listed as desired", async () => {
    const home = createPierHomeService({
      userDataPath: userData,
      now: () => now,
    });
    await home.ensure();
    await home.skills.create({
      skillId: "relink",
      description: "R",
      alwaysInclude: true,
      delivery: { agents: true, claude: false },
    });
    const channel = createPierBindingsChannel({
      userData,
      contentDirFor: (id) => home.skills.contentDir(id),
      listAlwaysIncludeSkills: () => home.skills.listAlwaysIncludeSkills(),
      listLibrarySkillIds: async () =>
        (await home.skills.list()).map((skill) => skill.id),
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const rootKey = createProjectSkillsPaths(userData).rootKeyFor(identity);

    const { mkdir, symlink } = await import("node:fs/promises");
    const linkPath = join(projectRoot, ".agents", "skills", "relink");
    await mkdir(join(projectRoot, ".agents", "skills"), { recursive: true });
    await symlink("../elsewhere", linkPath);

    const result = await channel.reconcile({
      projectIdentity: identity,
      rootKey,
    });
    expect(result.desiredProjections).toEqual([
      expect.objectContaining({
        skillId: "relink",
        relativeTarget: ".agents/skills/relink",
      }),
    ]);
    // No-replace: wrong link remains; repair plan consumes desiredProjections.
    expect(await readlink(linkPath)).toBe("../elsewhere");
  });
});
