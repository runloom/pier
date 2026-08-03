/**
 * PR4: first-party agent plugins must use host-hydrated env for production spawns.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "../../..");

const SPAWN_SITES = [
  "packages/plugin-codex/src/main/codex-provider.ts",
  "packages/plugin-codex/src/main/codex-usage.ts",
  "packages/plugin-grok/src/main/login-spawn.ts",
  "packages/plugin-grok/src/main/grok-provider.ts",
] as const;

describe("plugin spawn shell-env governance", () => {
  it("codex/grok production spawn paths use host-hydrated env, not bare process.env merge", () => {
    for (const rel of SPAWN_SITES) {
      const source = readFileSync(join(REPO, rel), "utf8");
      // Forbidden: classic GUI thin-PATH bug pattern.
      expect(
        source,
        `${rel} must not spread process.env over host env at spawn`
      ).not.toMatch(/env:\s*\{\s*\.\.\.process\.env/);
      expect(
        source.includes("hostSpawnEnv") ||
          source.includes("baseEnv") ||
          source.includes("Class A") ||
          source.includes("opts.env"),
        `${rel} must document/use host spawn env`
      ).toBe(true);
    }
  });

  it("plugin activate wires resolveProcessEnv into providers", () => {
    for (const rel of [
      "packages/plugin-codex/src/main/index.ts",
      "packages/plugin-grok/src/main/index.ts",
      "packages/plugin-claude/src/main/index.ts",
    ] as const) {
      const source = readFileSync(join(REPO, rel), "utf8");
      expect(source).toMatch(/resolveProcessEnv:\s*context\.resolveProcessEnv/);
    }
  });

  it("host context exposes CLAUDE_CONFIG_DIR on processEnv getters", () => {
    const source = readFileSync(
      join(REPO, "src/main/plugins/external-plugin-process-env.ts"),
      "utf8"
    );
    expect(source).toMatch(/CLAUDE_CONFIG_DIR/);
    expect(source).toMatch(/CODEX_HOME/);
    expect(source).toMatch(/GROK_HOME/);
  });
});
