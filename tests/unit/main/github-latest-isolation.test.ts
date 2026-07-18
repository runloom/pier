import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateLatestRelease,
  validatePluginReleaseIsolation,
} from "../../../scripts/verify-github-latest-isolation.mjs";

describe("GitHub Latest isolation", () => {
  it("accepts a host latest release with latest-mac.yml", () => {
    expect(
      validateLatestRelease(
        {
          tag_name: "v0.1.1",
          draft: false,
          prerelease: false,
          assets: [
            { name: "latest-mac.yml" },
            { name: "Pier-0.1.1-arm64-mac.zip" },
          ],
        },
        { expectVersion: "0.1.1" }
      )
    ).toEqual([]);
  });

  it("rejects plugin tag owning latest", () => {
    const errors = validateLatestRelease({
      tag_name: "plugin-codex-v1.3.1",
      draft: false,
      prerelease: true,
      assets: [{ name: "pier.codex-1.3.1.tgz" }],
    });
    expect(errors.join("\n")).toMatch(/plugin tag/i);
    expect(errors.join("\n")).toMatch(/latest-mac\.yml/i);
  });

  it("rejects draft or prerelease host latest", () => {
    expect(
      validateLatestRelease({
        tag_name: "v0.1.1",
        draft: true,
        prerelease: false,
        assets: [{ name: "latest-mac.yml" }],
      }).join("\n")
    ).toMatch(/draft/i);
    expect(
      validateLatestRelease({
        tag_name: "v0.1.1",
        draft: false,
        prerelease: true,
        assets: [{ name: "latest-mac.yml" }],
      }).join("\n")
    ).toMatch(/prerelease/i);
  });

  it("requires plugin releases to stay prerelease", () => {
    expect(
      validatePluginReleaseIsolation(
        { draft: false, prerelease: true },
        "plugin-codex-v1.3.1"
      )
    ).toEqual([]);
    expect(
      validatePluginReleaseIsolation(
        { draft: false, prerelease: false },
        "plugin-codex-v1.3.1"
      ).join("\n")
    ).toMatch(/must be prerelease/i);
  });

  it("wires the isolation gate into both release workflows", async () => {
    const appWf = await readFile(
      join(process.cwd(), ".github/workflows/release-app.yml"),
      "utf8"
    );
    const pluginWf = await readFile(
      join(process.cwd(), ".github/workflows/release-plugin.yml"),
      "utf8"
    );
    expect(appWf).toContain("verify-github-latest-isolation.mjs");
    expect(appWf).toContain("--expect-version");
    expect(pluginWf).toContain("verify-github-latest-isolation.mjs");
    expect(pluginWf).toContain("--plugin-tags");
    expect(pluginWf).toContain("--latest=false");
    expect(pluginWf).toContain("--prerelease");
  });
});
