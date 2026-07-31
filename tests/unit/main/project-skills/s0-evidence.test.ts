import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("project skills S0 evidence", () => {
  it("records official discovery facts and probe entrypoint", async () => {
    const spike = await readFile(
      join(
        process.cwd(),
        "docs/superpowers/spikes/2026-07-19-project-skills-s0.md"
      ),
      "utf8"
    );
    expect(spike).toContain("Codex");
    expect(spike).toContain(".agents/skills");
    expect(spike).toContain("Claude Code");
    expect(spike).toContain(".claude/skills");
    expect(spike).toContain("Cursor");
    expect(spike).toContain("OpenCode");
    expect(spike).toContain("symlink");
    expect(spike).toContain("duplicate-discovery");
    expect(spike).toContain("ManagedAgentLaunchGate");

    const probe = await readFile(
      join(process.cwd(), "scripts/project-skills/probe-agent-skills.mjs"),
      "utf8"
    );
    expect(probe).toContain("codex");
    expect(probe).toContain("claude");
  });
});
