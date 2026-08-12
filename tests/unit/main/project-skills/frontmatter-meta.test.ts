import { describe, expect, it } from "vitest";
import { parseSafeSkillFrontmatter } from "../../../../src/main/services/project-skills/frontmatter.ts";

describe("parseSafeSkillFrontmatter skill metadata", {
  timeout: 30_000,
}, () => {
  it("parses folded block scalar descriptions (>-)", () => {
    const md = `---
name: orchestration
description: >-
  Use Orca orchestration for structured multi-agent coordination.
  Prefer orca-cli for lightweight terminal prompts.
---

# Body
`;
    const { frontmatter } = parseSafeSkillFrontmatter(md);
    expect(frontmatter.name).toBe("orchestration");
    expect(String(frontmatter.description)).toContain("Orca orchestration");
    expect(String(frontmatter.description)).toContain("orca-cli");
  });

  it("does not reject bare * inside plain scalars (CLI tool globs)", () => {
    const md = `---
name: shadcn
description: Manages shadcn components and projects.
allowed-tools: Bash(npx shadcn@latest *), Bash(pnpm dlx shadcn@latest *)
---

# Body
`;
    const { frontmatter } = parseSafeSkillFrontmatter(md);
    expect(frontmatter.name).toBe("shadcn");
    expect(frontmatter.description).toBe(
      "Manages shadcn components and projects."
    );
  });
});
