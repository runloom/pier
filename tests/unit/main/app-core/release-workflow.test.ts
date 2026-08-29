import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("app release workflow", () => {
  it("publishes mac app updates to GitHub Latest on stable version tags", async () => {
    const source = await readFile(
      join(process.cwd(), ".github/workflows/release-app.yml"),
      "utf8"
    );
    expect(source).toContain("name: Release App");
    expect(source).toContain("tags:");
    expect(source).toContain("v*");
    expect(source).toContain("workflow_dispatch");
    expect(source).toContain("verify-app-release-version.mjs");
    expect(source).toContain("pnpm build:dist --publish=always");
    expect(source).toContain("contents: write");
    expect(source).toContain("latest-mac.yml");
    expect(source).toContain("verify-mac-release-artifacts.mjs");
    expect(source).toContain("PIER_DIST_ALLOW_CSC_LINK_PUBLISH");
    expect(source).toContain("runs-on: macos-26");
    expect(source).toContain("/Applications/Xcode_26.6.app/Contents/Developer");
    expect(source).toContain("Xcode 26.6");
    expect(source).toMatch(
      /ref:\s*\$\{\{\s*steps\.version\.outputs\.tag\s*\}\}/
    );
    expect(source).toContain("verify-github-latest-isolation.mjs");
    expect(source).toContain("--expect-version");
    expect(source).toContain("uses: ./.github/workflows/release-to-blog.yml");
    expect(source).toContain("secrets: inherit");
    expect(source).toMatch(
      /outputs:\s*\n\s+tag:\s*\$\{\{\s*steps\.version\.outputs\.tag\s*\}\}/
    );
  });

  it("routes host rc tags through candidate channel off Latest", async () => {
    const source = await readFile(
      join(process.cwd(), ".github/workflows/release-app.yml"),
      "utf8"
    );
    expect(source).toContain("CHANNEL=candidate");
    expect(source).toContain("CHANNEL=stable");
    // Tag-shape whitelist: only vX.Y.Z / vX.Y.Z-rc.N may proceed; any other
    // prerelease shape must hard-fail before it can steal Latest.
    expect(source).toContain("grep -Eq '^[0-9]+\\.[0-9]+\\.[0-9]+$'");
    expect(source).toContain(
      "grep -Eq '^[0-9]+\\.[0-9]+\\.[0-9]+-rc\\.[0-9]+$'"
    );
    expect(source).toContain(
      "is not a stable (vX.Y.Z) or candidate (vX.Y.Z-rc.N) host tag"
    );
    expect(source).toMatch(
      /channel:\s*\$\{\{\s*steps\.version\.outputs\.channel\s*\}\}/
    );
    expect(source).toContain("pnpm build:dist --publish=always --prerelease");
    expect(source).toContain("gh release edit");
    expect(source).toContain("--prerelease");
    expect(source).toContain("--latest=false");
    expect(source).toContain("--candidate-tag");
    expect(source).toMatch(
      /publish-blog:[\s\S]*if:\s*needs\.release\.outputs\.channel\s*==\s*'stable'/
    );
    expect(source).toContain("host-release-candidate-gold-standard.md");
  });

  it("locks the host release candidate gold-standard doc and AGENTS checkpoint", async () => {
    const gold = await readFile(
      join(
        process.cwd(),
        "docs/superpowers/specs/2026-08-29-host-release-candidate-gold-standard.md"
      ),
      "utf8"
    );
    const agents = await readFile(join(process.cwd(), "AGENTS.md"), "utf8");
    const skill = await readFile(
      join(process.cwd(), ".agents/skills/publish-project/SKILL.md"),
      "utf8"
    );
    expect(gold).toContain("宿主发布候选版金标准");
    expect(gold).toContain("三条路径");
    expect(agents).toContain("宿主发布候选版 — 金标准");
    expect(skill).toContain("晋升正式版");
    expect(skill).toContain("直接发布");
    expect(skill).toContain("默认路径直打无 rc 后缀");
  });

  it("keeps plugin releases off GitHub Latest", async () => {
    const source = await readFile(
      join(process.cwd(), ".github/workflows/release-plugin.yml"),
      "utf8"
    );
    expect(source).toMatch(/--latest=false/);
    expect(source).toMatch(/--prerelease|prerelease/);
  });
});
