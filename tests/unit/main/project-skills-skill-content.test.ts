import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveStableProjectIdentity,
  toContractProjectRootRef,
} from "@main/services/project-skills/identity.ts";
import {
  readSkillContent,
  SKILL_CONTENT_MAX_BYTES,
  SkillContentReadError,
} from "@main/services/project-skills/skill-content.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let projectRoot: string;
let homeDir: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "pier-skillread-proj-"));
  homeDir = await mkdtemp(join(tmpdir(), "pier-skillread-home-"));
});

afterEach(async () => {
  await Promise.all(
    [projectRoot, homeDir].map((dir) =>
      rm(dir, { force: true, recursive: true })
    )
  );
});

async function projectRef() {
  return toContractProjectRootRef(
    await resolveStableProjectIdentity(projectRoot)
  );
}

async function writeSkill(dir: string, body = "# Body\n"): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: x\ndescription: y\n---\n${body}`,
    "utf8"
  );
}

describe("skills.skill.read content access (read-only, whitelisted)", () => {
  it("reads managed library SKILL.md", async () => {
    await writeSkill(
      join(projectRoot, ".pier", "skills", "library", "review-guide")
    );
    const result = await readSkillContent({
      projectRef: await projectRef(),
      ref: { kind: "managed", skillId: "review-guide" },
    });
    expect(result.skillMd).toContain("# Body");
    expect(result.truncated).toBe(false);
  });

  it("reads project discovery-root SKILL.md and rejects unknown roots", async () => {
    await writeSkill(join(projectRoot, ".claude", "skills", "legacy"));
    const ref = await projectRef();
    const result = await readSkillContent({
      projectRef: ref,
      ref: { kind: "project", root: ".claude/skills", directoryName: "legacy" },
    });
    expect(result.skillMd).toContain("# Body");

    await expect(
      readSkillContent({
        projectRef: ref,
        ref: { kind: "project", root: "src", directoryName: "legacy" },
      })
    ).rejects.toBeInstanceOf(SkillContentReadError);
  });

  it("rejects traversal in directory names", async () => {
    const ref = await projectRef();
    await expect(
      readSkillContent({
        projectRef: ref,
        ref: {
          kind: "project",
          root: ".claude/skills",
          directoryName: "../secrets",
        },
      })
    ).rejects.toMatchObject({ code: "invalid-ref" });
    await expect(
      readSkillContent({
        projectRef: ref,
        ref: {
          kind: "user-global",
          root: "~/.claude/skills",
          directoryName: "..",
        },
      })
    ).rejects.toMatchObject({ code: "invalid-ref" });
  });

  it("reads user-global SKILL.md only from whitelisted roots", async () => {
    await writeSkill(join(homeDir, ".claude", "skills", "home-guide"));
    const ref = await projectRef();
    const result = await readSkillContent({
      projectRef: ref,
      ref: {
        kind: "user-global",
        root: "~/.claude/skills",
        directoryName: "home-guide",
      },
      homeDir,
    });
    expect(result.skillMd).toContain("# Body");

    await expect(
      readSkillContent({
        projectRef: ref,
        ref: {
          kind: "user-global",
          root: "~/Documents",
          directoryName: "home-guide",
        },
        homeDir,
      })
    ).rejects.toMatchObject({ code: "invalid-ref" });
  });

  it("caps oversized content and flags truncation", async () => {
    const dir = join(projectRoot, ".pier", "skills", "library", "big");
    await writeSkill(dir, "x".repeat(SKILL_CONTENT_MAX_BYTES + 1024));
    const result = await readSkillContent({
      projectRef: await projectRef(),
      ref: { kind: "managed", skillId: "big" },
    });
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.skillMd, "utf8")).toBeLessThanOrEqual(
      SKILL_CONTENT_MAX_BYTES
    );
  });

  it("missing skill reports not-found", async () => {
    await expect(
      readSkillContent({
        projectRef: await projectRef(),
        ref: { kind: "managed", skillId: "absent" },
      })
    ).rejects.toMatchObject({ code: "not-found" });
  });
});
