import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createProjectSkillsFileSystemAdapter } from "@main/services/project-skills/fs-adapter.ts";
import { resolveStableProjectIdentity } from "@main/services/project-skills/identity.ts";
import { isPathInside } from "@main/services/project-skills/import/fs.ts";
import { createProjectSkillsPaths } from "@main/services/project-skills/paths.ts";
import { systemProjectionIssueIds } from "@main/services/project-skills/snapshot-builder.ts";
import { createProjectSkillsStore } from "@main/services/project-skills/store/index.ts";
import {
  installSystemSkillCache,
  systemSkillCacheMarkerPath,
  systemSkillsCacheRoot,
} from "@main/services/project-skills/system-skills/cache.ts";
import { publishSystemSkillContent } from "@main/services/project-skills/system-skills/content.ts";
import {
  mergeSystemSkillExtraRootEnv,
  systemSkillExtraRootEnvPatch,
} from "@main/services/project-skills/system-skills/extra-root.ts";
import {
  ensureSystemSkillGitExclude,
  SYSTEM_SKILL_GIT_EXCLUDE_BEGIN,
} from "@main/services/project-skills/system-skills/git-exclude.ts";
import {
  assertSystemSkillContribution,
  createSystemSkillsChannel,
  SYSTEM_SKILL_PROJECTION_ROOTS,
} from "@main/services/project-skills/system-skills/index.ts";
import { resolveSystemSkillSourceDir } from "@main/services/project-skills/system-skills/source.ts";
import { computeTreeSha256V1 } from "@main/services/project-skills/tree-digest.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

let userData: string;
let projectRoot: string;
let contentDir: string;

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "pier-syschan-ud-"));
  projectRoot = await mkdtemp(join(tmpdir(), "pier-syschan-proj-"));
  contentDir = await mkdtemp(join(tmpdir(), "pier-syschan-content-"));
  await writeFile(
    join(contentDir, "SKILL.md"),
    "---\nname: pier-canvas\ndescription: Use the Pier canvas\n---\nBody\n",
    "utf8"
  );
});

afterEach(async () => {
  await Promise.all(
    [userData, projectRoot, contentDir].map((dir) =>
      rm(dir, { force: true, recursive: true })
    )
  );
});

function contribution(overrides?: Record<string, unknown>) {
  return {
    id: "pier-canvas",
    provider: { id: "pier.canvas", version: "1.0.0" },
    contentDir,
    ...overrides,
  };
}

describe("Pier system skills channel (v8 §8)", { timeout: 30_000 }, () => {
  it("systemProjectionIssueIds covers every system projection root", () => {
    expect([...SYSTEM_SKILL_PROJECTION_ROOTS]).toEqual([
      ".agents/skills",
      ".claude/skills",
    ]);
    const issueIds = systemProjectionIssueIds({
      ownedRoots: [".agents/skills"],
      presence: {
        ownedProjectedRoots: new Map(),
        unmanaged: [
          {
            root: ".claude/skills",
            directoryName: "pier-canvas",
            kind: "foreign-symlink",
            name: "",
            description: "",
            userInvocable: true,
          },
        ],
      },
      skillId: "pier-canvas",
    });
    expect(issueIds).toEqual([
      "unmanaged-conflict:pier-canvas::.claude/skills/pier-canvas",
    ]);
  });

  it("enforces the pier- prefix and provider identity", () => {
    expect(() =>
      assertSystemSkillContribution({
        id: "canvas",
        provider: { id: "p", version: "1" },
        contentDir,
      })
    ).toThrow(/pier-/);
    expect(() =>
      assertSystemSkillContribution({
        id: "pier-canvas",
        provider: { id: "", version: "" },
        contentDir,
      })
    ).toThrow(/provider/);
  });

  it("rejects dev-origin contributions in production (red line 1)", () => {
    const channel = createSystemSkillsChannel({
      userData,
      isProduction: true,
    });
    expect(() =>
      channel.register({ ...contribution(), devOrigin: true })
    ).toThrow(/dev-origin/);
    // Dev runtime accepts dev-origin registrations.
    const devChannel = createSystemSkillsChannel({
      userData,
      isProduction: false,
    });
    devChannel.register({ ...contribution(), devOrigin: true });
    expect(devChannel.list()).toHaveLength(1);
  });

  it("views expose contribution metadata before home-cache publish", async () => {
    const channel = createSystemSkillsChannel({
      userData,
      isProduction: false,
      contributions: [contribution()],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    const views = await channel.views(rootKey);
    expect(views).toEqual([
      expect.objectContaining({
        id: "pier-canvas",
        name: "pier-canvas",
        description: "Use the Pier canvas",
        contentDigest: null,
        enabled: true,
        provider: { id: "pier.canvas", version: "1.0.0" },
      }),
    ]);
  });

  it("reconcile publishes home cache, digest, projection and ownership", async () => {
    const store = createProjectSkillsStore({ userData });
    const channel = createSystemSkillsChannel({
      userData,
      store,
      isProduction: false,
      contributions: [contribution()],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    const result = await channel.reconcile({
      projectIdentity: identity,
      rootKey,
    });
    expect(result.published).toEqual(["pier-canvas"]);

    const cacheDir = join(userData, "skills", ".system", "pier-canvas");
    const skillMd = await readFile(join(cacheDir, "SKILL.md"), "utf8");
    expect(skillMd).toContain("pier-canvas");
    await expect(
      lstat(join(projectRoot, ".pier", "skills", "library", "pier-canvas"))
    ).rejects.toMatchObject({ code: "ENOENT" });

    const desired = JSON.parse(
      await readFile(
        join(paths.projectDir(rootKey), "system-skills.json"),
        "utf8"
      )
    ) as {
      publishedContentDigestsBySkillId: Record<string, string[]>;
    };
    expect(desired.publishedContentDigestsBySkillId["pier-canvas"]).toEqual([
      await computeTreeSha256V1(cacheDir),
    ]);

    const expected = result.desiredProjections[0]?.expectedRelativeLinkTarget;
    expect(expected).toBe(cacheDir);
    const agentsLink = join(projectRoot, ".agents", "skills", "pier-canvas");
    const claudeLink = join(projectRoot, ".claude", "skills", "pier-canvas");
    expect((await lstat(agentsLink)).isSymbolicLink()).toBe(true);
    expect((await lstat(claudeLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(agentsLink)).toBe(expected);
    expect(await readlink(claudeLink)).toBe(expected);
    const userDataReal = await realpath(userData);
    expect(await realpath(agentsLink)).toBe(await realpath(cacheDir));
    expect(await realpath(claudeLink)).toBe(await realpath(cacheDir));
    expect(isPathInside(userDataReal, await realpath(agentsLink))).toBe(true);
    expect(
      result.desiredProjections.map((p) => p.relativeTarget).sort()
    ).toEqual(
      [".agents/skills/pier-canvas", ".claude/skills/pier-canvas"].sort()
    );
    const ownership = await store.readOwnership(rootKey);
    expect(
      ownership?.targets.some(
        (t) => t.relativePath === ".agents/skills/pier-canvas"
      )
    ).toBe(true);
    expect(
      ownership?.targets.some(
        (t) => t.relativePath === ".claude/skills/pier-canvas"
      )
    ).toBe(true);
  });

  it("reconcile refreshes content on version change without touching foreign targets", async () => {
    const store = createProjectSkillsStore({ userData });
    const channel = createSystemSkillsChannel({
      userData,
      store,
      isProduction: false,
      contributions: [contribution()],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    await channel.reconcile({ projectIdentity: identity, rootKey });

    // Simulate a version upgrade: new content bytes.
    await writeFile(
      join(contentDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: Updated canvas capability\n---\nBody v2\n",
      "utf8"
    );
    channel.register({
      ...contribution(),
      provider: { id: "pier.canvas", version: "1.1.0" },
    });
    await channel.reconcile({ projectIdentity: identity, rootKey });
    const cacheDir = join(userData, "skills", ".system", "pier-canvas");
    const updated = await readFile(join(cacheDir, "SKILL.md"), "utf8");
    expect(updated).toContain("Updated canvas capability");

    const desired = JSON.parse(
      await readFile(
        join(paths.projectDir(rootKey), "system-skills.json"),
        "utf8"
      )
    ) as {
      publishedContentDigestsBySkillId: Record<string, string[]>;
    };
    expect(
      desired.publishedContentDigestsBySkillId["pier-canvas"]
    ).toHaveLength(2);
  });

  it("deletes leftover project library copies whose digest Pier already published", async () => {
    const store = createProjectSkillsStore({ userData });
    const channel = createSystemSkillsChannel({
      userData,
      store,
      isProduction: false,
      contributions: [contribution()],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    const libraryDir = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      "pier-canvas"
    );
    await mkdir(libraryDir, { recursive: true });
    await writeFile(
      join(libraryDir, "SKILL.md"),
      await readFile(join(contentDir, "SKILL.md"), "utf8"),
      "utf8"
    );

    await channel.reconcile({ projectIdentity: identity, rootKey });

    await expect(lstat(libraryDir)).rejects.toMatchObject({ code: "ENOENT" });
    const { readdir } = await import("node:fs/promises");
    const parent = join(projectRoot, ".pier", "skills", "library");
    const entries = await readdir(parent);
    expect(
      entries.some((entry) =>
        entry.startsWith(".pier-system-skill-quarantine-")
      )
    ).toBe(false);
  });

  it("quarantines leftover project library copies that were modified outside Pier", async () => {
    const store = createProjectSkillsStore({ userData });
    const channel = createSystemSkillsChannel({
      userData,
      store,
      isProduction: false,
      contributions: [contribution()],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    const libraryDir = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      "pier-canvas"
    );
    await mkdir(libraryDir, { recursive: true });
    await writeFile(
      join(libraryDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: Use the Pier canvas\n---\nBody\n",
      "utf8"
    );
    await writeFile(
      join(libraryDir, "NOTES.md"),
      "user modifications worth keeping\n",
      "utf8"
    );

    await channel.reconcile({ projectIdentity: identity, rootKey });

    const cacheDir = join(userData, "skills", ".system", "pier-canvas");
    expect(await readFile(join(cacheDir, "SKILL.md"), "utf8")).toContain(
      "pier-canvas"
    );
    await expect(lstat(libraryDir)).rejects.toMatchObject({ code: "ENOENT" });
    const { readdir } = await import("node:fs/promises");
    const parent = join(projectRoot, ".pier", "skills", "library");
    const entries = await readdir(parent);
    const quarantine = entries.find((entry) =>
      entry.startsWith(".pier-system-skill-quarantine-")
    );
    expect(quarantine).toBeDefined();
    if (quarantine) {
      expect(
        await readFile(join(parent, quarantine, "NOTES.md"), "utf8")
      ).toContain("worth keeping");
    }
  });

  it("sweeps leftover official quarantines when retiring the project library", async () => {
    const store = createProjectSkillsStore({ userData });
    const channel = createSystemSkillsChannel({
      userData,
      store,
      isProduction: false,
      contributions: [contribution()],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    await channel.reconcile({ projectIdentity: identity, rootKey });

    await writeFile(
      join(contentDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: v2\n---\nBody v2\n",
      "utf8"
    );
    const parent = join(projectRoot, ".pier", "skills", "library");
    const leftover = join(
      parent,
      ".pier-system-skill-quarantine-1-pier-canvas"
    );
    await mkdir(leftover, { recursive: true });
    await writeFile(
      join(leftover, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: v2\n---\nBody v2\n",
      "utf8"
    );

    await channel.reconcile({ projectIdentity: identity, rootKey });
    const cacheDir = join(userData, "skills", ".system", "pier-canvas");
    expect(await readFile(join(cacheDir, "SKILL.md"), "utf8")).toContain("v2");
    await expect(lstat(join(parent, "pier-canvas"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const { readdir } = await import("node:fs/promises");
    const leftoverNow = (await readdir(parent)).filter((entry) =>
      entry.startsWith(".pier-system-skill-quarantine-")
    );
    expect(leftoverNow).toEqual([]);
  });

  it("does not let an untrusted project vendor overwrite the home cache", async () => {
    const store = createProjectSkillsStore({ userData });
    const channel = createSystemSkillsChannel({
      userData,
      store,
      isProduction: false,
      contributions: [contribution()],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    const projectSkillDir = join(
      projectRoot,
      "resources",
      "system-skills",
      "pier-canvas"
    );
    await mkdir(projectSkillDir, { recursive: true });
    await writeFile(
      join(projectSkillDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: repo source\n---\nFrom project resources\n",
      "utf8"
    );

    await channel.reconcile({ projectIdentity: identity, rootKey });
    const cacheDir = join(userData, "skills", ".system", "pier-canvas");
    expect(await readFile(join(cacheDir, "SKILL.md"), "utf8")).toContain(
      "Body"
    );
    expect(await readFile(join(cacheDir, "SKILL.md"), "utf8")).not.toContain(
      "From project resources"
    );
    await expect(
      lstat(join(projectRoot, ".pier", "skills", "library", "pier-canvas"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("dogfoods in-repo resources when the registered contentDir is already in the project", async () => {
    const bundledDir = join(
      projectRoot,
      "out",
      "resources",
      "system-skills",
      "pier-canvas"
    );
    await mkdir(bundledDir, { recursive: true });
    await writeFile(
      join(bundledDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: bundled\n---\nFrom bundle\n",
      "utf8"
    );
    const projectSkillDir = join(
      projectRoot,
      "resources",
      "system-skills",
      "pier-canvas"
    );
    await mkdir(projectSkillDir, { recursive: true });
    await writeFile(
      join(projectSkillDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: repo source\n---\nFrom project resources\n",
      "utf8"
    );

    const store = createProjectSkillsStore({ userData });
    const channel = createSystemSkillsChannel({
      userData,
      store,
      isProduction: false,
      contributions: [contribution({ contentDir: bundledDir })],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    await channel.reconcile({ projectIdentity: identity, rootKey });
    const cacheDir = join(userData, "skills", ".system", "pier-canvas");
    expect(await readFile(join(cacheDir, "SKILL.md"), "utf8")).toContain(
      "From project resources"
    );
    await expect(
      lstat(join(projectRoot, ".pier", "skills", "library", "pier-canvas"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("production installs only the registered contentDir even when the project vendors the skill", async () => {
    const bundledDir = join(
      projectRoot,
      "out",
      "resources",
      "system-skills",
      "pier-canvas"
    );
    await mkdir(bundledDir, { recursive: true });
    await writeFile(
      join(bundledDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: bundled\n---\nFrom bundle\n",
      "utf8"
    );
    const projectSkillDir = join(
      projectRoot,
      "resources",
      "system-skills",
      "pier-canvas"
    );
    await mkdir(projectSkillDir, { recursive: true });
    await writeFile(
      join(projectSkillDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: repo source\n---\nFrom project resources\n",
      "utf8"
    );

    const store = createProjectSkillsStore({ userData });
    const channel = createSystemSkillsChannel({
      userData,
      store,
      isProduction: true,
      contributions: [contribution({ contentDir: bundledDir })],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    await channel.reconcile({ projectIdentity: identity, rootKey });
    const cacheDir = join(userData, "skills", ".system", "pier-canvas");
    expect(await readFile(join(cacheDir, "SKILL.md"), "utf8")).toContain(
      "From bundle"
    );
    expect(await readFile(join(cacheDir, "SKILL.md"), "utf8")).not.toContain(
      "From project resources"
    );
  });

  it("bindings publish contribution.contentDir even when project vendors the same id", async () => {
    const projectSkillDir = join(
      projectRoot,
      "resources",
      "system-skills",
      "pier-canvas"
    );
    await mkdir(projectSkillDir, { recursive: true });
    await writeFile(
      join(projectSkillDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: vendor\n---\nFrom project resources\n",
      "utf8"
    );
    await publishSystemSkillContent({
      projectRoot,
      contribution: contribution(),
      publishedDigests: [],
    });
    const libraryDir = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      "pier-canvas"
    );
    expect(await readFile(join(libraryDir, "SKILL.md"), "utf8")).toContain(
      "Body"
    );
    expect(await readFile(join(libraryDir, "SKILL.md"), "utf8")).not.toContain(
      "From project resources"
    );
  });

  it("projects the current official source even when that source is older", async () => {
    const store = createProjectSkillsStore({ userData });
    const channel = createSystemSkillsChannel({
      userData,
      store,
      isProduction: false,
      contributions: [contribution()],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    await channel.reconcile({ projectIdentity: identity, rootKey });

    await writeFile(
      join(contentDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: v2\n---\nBody v2\n",
      "utf8"
    );
    await channel.reconcile({ projectIdentity: identity, rootKey });

    await writeFile(
      join(contentDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: Use the Pier canvas\n---\nBody\n",
      "utf8"
    );
    await channel.reconcile({ projectIdentity: identity, rootKey });
    const cacheDir = join(userData, "skills", ".system", "pier-canvas");
    expect(await readFile(join(cacheDir, "SKILL.md"), "utf8")).toContain(
      "---\nname: pier-canvas\ndescription: Use the Pier canvas\n---\nBody\n"
    );
    await expect(
      lstat(join(projectRoot, ".pier", "skills", "library", "pier-canvas"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never replaces an unmanaged target at the projection path (red line 2)", async () => {
    const store = createProjectSkillsStore({ userData });
    const channel = createSystemSkillsChannel({
      userData,
      store,
      isProduction: false,
      contributions: [contribution()],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    // Pre-existing real directory at the projection path.
    const target = join(projectRoot, ".agents", "skills", "pier-canvas");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "USER.md"), "user content\n", "utf8");

    await channel.reconcile({ projectIdentity: identity, rootKey });
    const info = await lstat(target);
    expect(info.isDirectory()).toBe(true);
    expect(info.isSymbolicLink()).toBe(false);
    expect(await readFile(join(target, "USER.md"), "utf8")).toBe(
      "user content\n"
    );
  });

  it("refuses projection when .agents is a symlink out of the project (§6.1)", async () => {
    const escapeRoot = await mkdtemp(join(tmpdir(), "pier-syschan-escape-"));
    try {
      await symlink(escapeRoot, join(projectRoot, ".agents"));
      const store = createProjectSkillsStore({ userData });
      const channel = createSystemSkillsChannel({
        userData,
        store,
        isProduction: false,
        contributions: [contribution()],
      });
      const identity = await resolveStableProjectIdentity(projectRoot);
      const paths = createProjectSkillsPaths(userData);
      const rootKey = paths.rootKeyFor(identity);

      const result = await channel.reconcile({
        projectIdentity: identity,
        rootKey,
      });
      // Home cache may still install; projection must not land in escapeRoot.
      const escaped = join(escapeRoot, "skills", "pier-canvas");
      await expect(lstat(escaped)).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        result.desiredProjections.some(
          (p) => p.relativeTarget === ".agents/skills/pier-canvas"
        )
      ).toBe(true);
    } finally {
      await rm(escapeRoot, { force: true, recursive: true });
    }
  });

  it("replaces an owned legacy library-relative discovery link with the home cache", async () => {
    const store = createProjectSkillsStore({ userData });
    const channel = createSystemSkillsChannel({
      userData,
      store,
      isProduction: false,
      contributions: [contribution()],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    const relativeTarget = ".agents/skills/pier-canvas";
    const linkPath = join(projectRoot, ".agents", "skills", "pier-canvas");
    await mkdir(join(projectRoot, ".agents", "skills"), { recursive: true });
    await symlink("../../.pier/skills/library/pier-canvas", linkPath);
    const live =
      await createProjectSkillsFileSystemAdapter().lstatIdentity(linkPath);
    await store.commitOwnership(rootKey, 0, {
      schemaVersion: 1,
      generation: 1,
      projectIdentity: identity,
      targets: [
        {
          relativePath: relativeTarget,
          skillId: "pier-canvas",
          expectedRelativeLinkTarget: "../../.pier/skills/library/pier-canvas",
          objectIdentity: {
            dev: live.dev,
            ino: live.ino,
            mode: live.mode,
            nlink: live.nlink,
            isDirectory: live.isDirectory,
            isSymbolicLink: live.isSymbolicLink,
          },
          createdByOperationId: "legacy",
          createdAt: Date.now(),
        },
      ],
    });

    const result = await channel.reconcile({
      projectIdentity: identity,
      rootKey,
    });
    const expected = result.desiredProjections.find(
      (p) => p.relativeTarget === relativeTarget
    )?.expectedRelativeLinkTarget;
    expect(await readlink(linkPath)).toBe(expected);
    expect(expected).toBe(join(userData, "skills", ".system", "pier-canvas"));
  });

  it("does not replace an unowned legacy library-relative discovery link", async () => {
    const store = createProjectSkillsStore({ userData });
    const channel = createSystemSkillsChannel({
      userData,
      store,
      isProduction: false,
      contributions: [contribution()],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);

    const linkPath = join(projectRoot, ".agents", "skills", "pier-canvas");
    await mkdir(join(projectRoot, ".agents", "skills"), { recursive: true });
    await symlink("../../.pier/skills/library/pier-canvas", linkPath);

    await channel.reconcile({ projectIdentity: identity, rootKey });
    expect(await readlink(linkPath)).toBe(
      "../../.pier/skills/library/pier-canvas"
    );
  });

  it("skips rewriting the home cache when the fingerprint still matches", async () => {
    const first = await installSystemSkillCache({
      contribution: contribution(),
      projectRoot,
      userData,
    });
    await writeFile(join(first.cacheDir, "SENTINEL"), "keep\n", "utf8");
    const markerBefore = await readFile(
      systemSkillCacheMarkerPath(userData, "pier-canvas"),
      "utf8"
    );

    const second = await installSystemSkillCache({
      contribution: contribution(),
      projectRoot,
      userData,
    });
    expect(second.cacheDir).toBe(first.cacheDir);
    expect(await readFile(join(second.cacheDir, "SENTINEL"), "utf8")).toBe(
      "keep\n"
    );
    expect(
      await readFile(
        systemSkillCacheMarkerPath(userData, "pier-canvas"),
        "utf8"
      )
    ).toBe(markerBefore);
  });

  it("writes local git exclude for product-skill discovery links", async () => {
    await execFileAsync("git", ["init"], { cwd: projectRoot });
    const store = createProjectSkillsStore({ userData });
    const channel = createSystemSkillsChannel({
      userData,
      store,
      isProduction: false,
      contributions: [contribution()],
    });
    const identity = await resolveStableProjectIdentity(projectRoot);
    const paths = createProjectSkillsPaths(userData);
    const rootKey = paths.rootKeyFor(identity);
    await channel.reconcile({ projectIdentity: identity, rootKey });
    const { stdout } = await execFileAsync(
      "git",
      [
        "-C",
        projectRoot,
        "check-ignore",
        "-v",
        "--",
        ".agents/skills/pier-canvas",
      ],
      { cwd: projectRoot }
    );
    expect(stdout).toMatch(/pier-\*/);
    await ensureSystemSkillGitExclude(projectRoot);
    const { stdout: excludePath } = await execFileAsync(
      "git",
      ["-C", projectRoot, "rev-parse", "--git-path", "info/exclude"],
      { cwd: projectRoot }
    );
    const raw = excludePath.trim();
    const absolute = raw.startsWith("/") ? raw : join(projectRoot, raw);
    const exclude = await readFile(absolute, "utf8");
    expect(exclude).toContain(SYSTEM_SKILL_GIT_EXCLUDE_BEGIN);
    const once = exclude.split(SYSTEM_SKILL_GIT_EXCLUDE_BEGIN).length - 1;
    expect(once).toBe(1);
  });

  it("resolves git exclude through a worktree gitdir file", async () => {
    await execFileAsync("git", ["init"], { cwd: projectRoot });
    await execFileAsync(
      "git",
      [
        "-C",
        projectRoot,
        "-c",
        "user.email=a@b.c",
        "-c",
        "user.name=t",
        "commit",
        "--allow-empty",
        "-m",
        "init",
      ],
      { cwd: projectRoot }
    );
    const worktree = await mkdtemp(join(tmpdir(), "pier-syschan-wt-"));
    try {
      await execFileAsync(
        "git",
        ["-C", projectRoot, "worktree", "add", "--detach", worktree],
        { cwd: projectRoot }
      );
      await ensureSystemSkillGitExclude(worktree);
      const { stdout } = await execFileAsync(
        "git",
        [
          "-C",
          worktree,
          "check-ignore",
          "-v",
          "--",
          ".agents/skills/pier-canvas",
        ],
        { cwd: worktree }
      );
      expect(stdout).toMatch(/pier-\*/);
    } finally {
      await execFileAsync("git", [
        "-C",
        projectRoot,
        "worktree",
        "remove",
        "--force",
        worktree,
      ]).catch(() => undefined);
      await rm(worktree, { force: true, recursive: true });
    }
  });

  it("skips git exclude when the project is not a git repository", async () => {
    await ensureSystemSkillGitExclude(projectRoot);
    await expect(
      lstat(join(projectRoot, ".git", "info", "exclude"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("system skill extra-root seam", () => {
  it("returns no env patch when the adapter has no extra-root", () => {
    expect(
      systemSkillExtraRootEnvPatch({
        extraRoot: undefined,
        systemSkillsRoot: "/tmp/skills/.system",
      })
    ).toEqual({});
  });

  it("emits the extra-root when an adapter declares one", () => {
    expect(
      systemSkillExtraRootEnvPatch({
        extraRoot: { envKey: "PIER_SYSTEM_SKILLS" },
        systemSkillsRoot: "/tmp/skills/.system",
      })
    ).toEqual({ PIER_SYSTEM_SKILLS: "/tmp/skills/.system" });
  });

  it("does not clobber an existing env key", async () => {
    const userData = await mkdtemp(join(tmpdir(), "pier-extra-root-"));
    try {
      const merged = mergeSystemSkillExtraRootEnv({
        agentKind: "codex",
        env: { PATH: "/usr/bin" },
        userData,
      });
      expect(merged.PATH).toBe("/usr/bin");
      expect(merged).toEqual({ PATH: "/usr/bin" });
      expect(systemSkillsCacheRoot(userData)).toBe(
        join(userData, "skills", ".system")
      );
    } finally {
      await rm(userData, { force: true, recursive: true });
    }
  });
});

describe("system skill source gate", () => {
  it("refuses a vendor directory that is a symlink out of the project", async () => {
    const bundledDir = join(
      projectRoot,
      "out",
      "resources",
      "system-skills",
      "pier-canvas"
    );
    await mkdir(bundledDir, { recursive: true });
    await writeFile(
      join(bundledDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: bundled\n---\nFrom bundle\n",
      "utf8"
    );
    const escapeRoot = await mkdtemp(join(tmpdir(), "pier-syschan-vendor-"));
    try {
      await writeFile(
        join(escapeRoot, "SKILL.md"),
        "---\nname: pier-canvas\ndescription: escaped\n---\nEscaped\n",
        "utf8"
      );
      await mkdir(join(projectRoot, "resources", "system-skills"), {
        recursive: true,
      });
      await symlink(
        escapeRoot,
        join(projectRoot, "resources", "system-skills", "pier-canvas")
      );
      const resolved = await resolveSystemSkillSourceDir({
        allowProjectVendorSource: true,
        fallbackContentDir: bundledDir,
        projectRoot,
        skillId: "pier-canvas",
      });
      expect(resolved).toBe(bundledDir);
    } finally {
      await rm(escapeRoot, { force: true, recursive: true });
    }
  });

  it("refuses a vendor tree whose realpath escapes via a parent symlink", async () => {
    const bundledDir = join(
      projectRoot,
      "out",
      "resources",
      "system-skills",
      "pier-canvas"
    );
    await mkdir(bundledDir, { recursive: true });
    await writeFile(
      join(bundledDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: bundled\n---\nFrom bundle\n",
      "utf8"
    );
    const escapeRoot = await mkdtemp(join(tmpdir(), "pier-syschan-parent-"));
    try {
      await mkdir(join(escapeRoot, "system-skills", "pier-canvas"), {
        recursive: true,
      });
      await writeFile(
        join(escapeRoot, "system-skills", "pier-canvas", "SKILL.md"),
        "---\nname: pier-canvas\ndescription: escaped\n---\nEscaped\n",
        "utf8"
      );
      await rm(join(projectRoot, "resources"), {
        force: true,
        recursive: true,
      });
      await symlink(escapeRoot, join(projectRoot, "resources"));
      const resolved = await resolveSystemSkillSourceDir({
        allowProjectVendorSource: true,
        fallbackContentDir: bundledDir,
        projectRoot,
        skillId: "pier-canvas",
      });
      expect(resolved).toBe(bundledDir);
    } finally {
      await rm(escapeRoot, { force: true, recursive: true });
    }
  });
});
