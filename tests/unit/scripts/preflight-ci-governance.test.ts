import { accessSync, constants, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts/preflight-ci.sh");
const PRE_PUSH = join(ROOT, ".husky/pre-push");
const PACKAGE_JSON = join(ROOT, "package.json");
const CI_YML = join(ROOT, ".github/workflows/ci.yml");

describe("preflight-ci governance", () => {
  it("ships an executable preflight with correctness-first tiers", () => {
    accessSync(SCRIPT, constants.X_OK);
    const source = readFileSync(SCRIPT, "utf8");
    for (const tier of ["push", "merge", "ci", "full"] as const) {
      expect(source).toContain(tier);
    }
    // push tier must run unit+component so CI is not the first place tests fail
    expect(source).toContain("pnpm check:static");
    expect(source).toContain("vitest run tests/unit");
    expect(source).toContain("vitest run tests/component");
    // Local preflight caps workers on coverage too (same flake surface as unit).
    expect(source).toContain("vitest run --coverage");
    expect(source).toContain("maxWorkers");
    expect(source).toContain("pnpm build");
  });

  it("exposes preflight package scripts; coverage stays file-parallel", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.preflight).toContain("preflight-ci.sh");
    expect(pkg.scripts["preflight:push"]).toContain("push");
    expect(pkg.scripts["preflight:merge"]).toContain("merge");
    expect(pkg.scripts["preflight:ci"]).toContain("ci");
    expect(pkg.scripts["preflight:full"]).toContain("full");
    // Package script remains uncapped for CI; preflight-ci.sh applies local cap.
    expect(pkg.scripts["test:coverage"]).not.toContain("no-file-parallelism");
  });

  it("default pre-push is preflight:push (not static-only)", () => {
    const hook = readFileSync(PRE_PUSH, "utf8");
    expect(hook).toContain("PIER_PREFLIGHT:-push");
    expect(hook).toContain("preflight:");
  });

  it("Quality Gate skips heavy jobs via path filters; no job wall-clock timeouts", () => {
    const workflow = readFileSync(CI_YML, "utf8");
    expect(workflow).toContain("dorny/paths-filter");
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).not.toMatch(/^\s*timeout-minutes:\s*\d+\s*$/m);
    // native / windows_lsp filters must not include package.json (every PR would run them).
    const windowsBlock = workflow.match(
      /windows_lsp:\n(?:[ \t]+- '[^']+'\n)+/
    )?.[0];
    const nativeBlock = workflow.match(/native:\n(?:[ \t]+- '[^']+'\n)+/)?.[0];
    expect(windowsBlock).toBeTruthy();
    expect(nativeBlock).toBeTruthy();
    expect(windowsBlock).not.toContain("package.json");
    expect(nativeBlock).not.toContain("package.json");
    expect(workflow).toMatch(/require_ok_or_skipped|skipped/);
  });
});
