// @vitest-environment node
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  bundledSystemSkillContributions,
  PIER_CANVAS_SYSTEM_SKILL_ID,
  PIER_SUBAGENT_PANELS_SYSTEM_SKILL_ID,
} from "@main/app-core/bundled-system-skills.ts";
import {
  systemSkillContentDir,
  systemSkillsRootDir,
} from "@main/services/project-skills/system-skills/asset-paths.ts";
import { assertSystemSkillContribution } from "@main/services/project-skills/system-skills/index.ts";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const resourcesRoot = join(process.cwd(), "resources");

describe("bundled system skills", () => {
  it("registers pier-canvas with a real content directory", async () => {
    const contributions = bundledSystemSkillContributions({
      appVersion: "0.1.10-test",
      resourcesRoot,
    });
    // 委派 CLI 走仓库文档（docs/pier-agents-delegation.md），不再捆绑技能：
    // 模型可自动调用的委派技能与 Claude Code teams 模式撞车（都产面板子智能体）。
    expect(contributions.map((c) => c.id)).toEqual([
      PIER_CANVAS_SYSTEM_SKILL_ID,
      PIER_SUBAGENT_PANELS_SYSTEM_SKILL_ID,
    ]);
    for (const contribution of contributions) {
      assertSystemSkillContribution(contribution);
      expect(contribution.provider.id).toBe("pier.app");
      expect(contribution.provider.version).toBe("0.1.10-test");
      expect(contribution.contentDir).toBe(
        systemSkillContentDir(resourcesRoot, contribution.id)
      );
      await access(join(contribution.contentDir, "SKILL.md"));
    }
  });

  it("does not ship multi-agent collaboration as a system skill", () => {
    const ids = bundledSystemSkillContributions({
      appVersion: "0.0.0",
      resourcesRoot,
    }).map((c) => c.id);
    expect(ids).not.toContain("pier-agent-collaboration");
    expect(ids.some((id) => id.includes("collaborat"))).toBe(false);
  });

  it("packs system-skills via electron-builder extraResources (prod layout)", async () => {
    const builderConfig = await readFile(
      join(process.cwd(), "electron-builder.yml"),
      "utf8"
    );
    expect(builderConfig).toMatch(/from:\s*resources\/system-skills/);
    expect(builderConfig).toMatch(/to:\s*system-skills/);

    // Packaged layout: process.resourcesPath is the resources root; skills
    // land at {resourcesPath}/system-skills/<id> (extraResources `to`).
    const packagedResourcesRoot = "/Applications/Pier.app/Contents/Resources";
    expect(systemSkillsRootDir(packagedResourcesRoot)).toBe(
      join(packagedResourcesRoot, "system-skills")
    );
    expect(
      systemSkillContentDir(packagedResourcesRoot, PIER_CANVAS_SYSTEM_SKILL_ID)
    ).toBe(
      join(packagedResourcesRoot, "system-skills", PIER_CANVAS_SYSTEM_SKILL_ID)
    );

    // Source tree the builder copies from must exist (CI green alone is not
    // enough if someone deletes resources/system-skills but keeps yml).
    await access(
      join(
        process.cwd(),
        "resources",
        "system-skills",
        PIER_CANVAS_SYSTEM_SKILL_ID,
        "SKILL.md"
      )
    );
  });

  it("does not treat project library as a bundled source (home cache is live)", async () => {
    // Reconcile installs `{userData}/skills/.system` and must not create
    // `.pier/skills/library/pier-*` (covered in system-skills.test.ts).
    // Leftover library trees from older Pier builds stay untracked.
    const librarySkillMd = join(
      ".pier",
      "skills",
      "library",
      PIER_CANVAS_SYSTEM_SKILL_ID,
      "SKILL.md"
    );
    const { stdout: ignored } = await execFileAsync(
      "git",
      ["check-ignore", "-v", "--", librarySkillMd],
      { cwd: process.cwd() }
    );
    expect(ignored).toMatch(/pier-\*/);

    const { stdout: tracked } = await execFileAsync(
      "git",
      ["ls-files", "--", `.pier/skills/library/${PIER_CANVAS_SYSTEM_SKILL_ID}`],
      { cwd: process.cwd() }
    );
    expect(tracked.trim()).toBe("");

    const quarantineSample = join(
      ".pier",
      "skills",
      "library",
      `.pier-system-skill-quarantine-0-${PIER_CANVAS_SYSTEM_SKILL_ID}`,
      "SKILL.md"
    );
    const { stdout: quarantineIgnored } = await execFileAsync(
      "git",
      ["check-ignore", "-v", "--", quarantineSample],
      { cwd: process.cwd() }
    );
    expect(quarantineIgnored).toMatch(/\.pier-system-skill-\*/);
  });
});
