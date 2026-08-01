import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("app release workflow", () => {
  it("publishes mac app updates to GitHub Latest on version tags", async () => {
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
    expect(source).toMatch(
      /ref:\s*\$\{\{\s*steps\.version\.outputs\.tag\s*\}\}/
    );
    expect(source).toContain("verify-github-latest-isolation.mjs");
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
