import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("development entrypoint governance", () => {
  it("keeps both documented desktop dev commands on the plugin-aware path", () => {
    const packageJson = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    const devOrchestrator = readFileSync(
      join(ROOT, "scripts/dev-with-plugins.mjs"),
      "utf8"
    );

    expect(packageJson.scripts.predev).toContain("plugins:pack");
    expect(packageJson.scripts.dev).toBe("node ./scripts/dev-with-plugins.mjs");
    expect(packageJson.scripts["electron:dev"]).toBe("pnpm dev");
    expect(packageJson.scripts["dev:host"]).toBe(
      "node ./scripts/dev-profile.mjs electron-dev"
    );
    expect(devOrchestrator).toContain('start("plugin-codex main watch"');
    expect(devOrchestrator).toContain('start("plugin-codex renderer watch"');
    expect(devOrchestrator).toContain('start("electron dev"');
  });
});
