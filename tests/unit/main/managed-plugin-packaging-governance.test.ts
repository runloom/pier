import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const builderConfig = readFileSync(
  join(process.cwd(), "electron-builder.yml"),
  "utf8"
);
const releaseWorkflow = readFileSync(
  join(process.cwd(), ".github/workflows/release-plugin.yml"),
  "utf8"
);
const buildDistScript = readFileSync(
  join(process.cwd(), "scripts/build-dist.sh"),
  "utf8"
);
const committedOfficialIndex = JSON.parse(
  readFileSync(join(process.cwd(), "plugins/index.v1.json"), "utf8")
) as { signature?: { alg?: string } };

describe("managed plugin packaging governance", () => {
  it("ships bundled plugin metadata beside packaged archives", () => {
    expect(builderConfig).toMatch(/to:\s*plugin-packages/);
    expect(builderConfig).toContain("*.tgz");
    expect(builderConfig).toContain("*.tgz.sha256");
    expect(builderConfig).toContain("plugin.json");
    expect(buildDistScript).toContain("pnpm plugin:codex:pack");
  });

  it("requires Ed25519 signing when the release workflow regenerates the official index", () => {
    expect(releaseWorkflow).toContain("PIER_PLUGIN_INDEX_REQUIRE_SIGNATURE");
    expect(releaseWorkflow).toContain(
      "PIER_PLUGIN_INDEX_SIGNING_PRIVATE_KEY_BASE64"
    );
    expect(releaseWorkflow).toContain("PIER_PLUGIN_INDEX_SIGNING_KEY_ID");
  });

  it("does not commit an unsigned official index", () => {
    expect(committedOfficialIndex.signature?.alg).toBe("Ed25519");
  });
});
