import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveStableProjectIdentity } from "@main/services/project-skills/identity.ts";
import { createProjectSkillsPaths } from "@main/services/project-skills/paths.ts";
import { systemProjectionIssueIds } from "@main/services/project-skills/snapshot-builder.ts";
import { createProjectSkillsStore } from "@main/services/project-skills/store/index.ts";
import {
  assertSystemSkillContribution,
  createSystemSkillsChannel,
  SYSTEM_SKILL_PROJECTION_ROOTS,
} from "@main/services/project-skills/system-skills/index.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

  it("views expose contribution metadata before project library publish", async () => {
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

  it("reconcile publishes library snapshot, digest, projection and ownership", async () => {
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

    // Library snapshot in the project.
    const libraryDir = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      "pier-canvas"
    );
    const skillMd = await readFile(join(libraryDir, "SKILL.md"), "utf8");
    expect(skillMd).toContain("pier-canvas");

    const desired = JSON.parse(
      await readFile(
        join(paths.projectDir(rootKey), "system-skills.json"),
        "utf8"
      )
    ) as {
      publishedContentDigestsBySkillId: Record<string, string[]>;
    };
    expect(desired.publishedContentDigestsBySkillId["pier-canvas"]).toEqual([
      expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    ]);

    // Dual-root projection + ownership (agents + claude) for Claude L1/TUI.
    const agentsLink = join(projectRoot, ".agents", "skills", "pier-canvas");
    const claudeLink = join(projectRoot, ".claude", "skills", "pier-canvas");
    expect((await lstat(agentsLink)).isSymbolicLink()).toBe(true);
    expect((await lstat(claudeLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(agentsLink)).toBe(
      "../../.pier/skills/library/pier-canvas"
    );
    expect(await readlink(claudeLink)).toBe(
      "../../.pier/skills/library/pier-canvas"
    );
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
    const libraryDir = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      "pier-canvas"
    );
    const updated = await readFile(join(libraryDir, "SKILL.md"), "utf8");
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

  it("quarantines externally modified content on version refresh instead of destroying it (v8.2 §9)", async () => {
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

    // External tamper: user (or something else) edits the published copy.
    const libraryDir = join(
      projectRoot,
      ".pier",
      "skills",
      "library",
      "pier-canvas"
    );
    await writeFile(
      join(libraryDir, "NOTES.md"),
      "user modifications worth keeping\n",
      "utf8"
    );

    // Version upgrade triggers the swap.
    await writeFile(
      join(contentDir, "SKILL.md"),
      "---\nname: pier-canvas\ndescription: v2\n---\nBody v2\n",
      "utf8"
    );
    channel.register({
      ...contribution(),
      provider: { id: "pier.canvas", version: "2.0.0" },
    });
    await channel.reconcile({ projectIdentity: identity, rootKey });

    // New content published…
    expect(await readFile(join(libraryDir, "SKILL.md"), "utf8")).toContain(
      "v2"
    );
    // …and the tampered snapshot is preserved in a quarantine dir.
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
      // Library may still publish under .pier; projection must not land in escapeRoot.
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
});
