import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../..");

const SCAN_ROOTS = [
  join(REPO_ROOT, "packages/ui/src/file"),
  join(REPO_ROOT, "src/plugins/builtin/files/renderer/tree"),
  join(REPO_ROOT, "src/plugins/builtin/git/renderer/review"),
] as const;

/** Host scroll writes must stay in scroll owner / pure restore helpers. */
const SCROLL_TOP_WRITE_ALLOWLIST = new Set([
  "packages/ui/src/file/tree-scroll.ts",
  "packages/ui/src/file/tree-scroll-owner.ts",
]);

const PUBLIC_CONTROLLER = join(REPO_ROOT, "packages/ui/src/file/tree-types.ts");

const LOCK_FRAMES_BAN =
  /restoreSnapshotSoon\s*\([\s\S]{0,200}?(lock\s*:\s*true|frames\s*:\s*[2-9])/m;

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) {
      continue;
    }
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkSourceFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("file-tree scroll ownership governance (P5)", () => {
  const files = SCAN_ROOTS.flatMap((root) => walkSourceFiles(root));

  it("scans production sources under tree UI and files/git trees", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("bans multi-frame lock path-sync restore in production", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file);
      if (rel.includes(".test.") || rel.includes("__tests__")) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (LOCK_FRAMES_BAN.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("allows scrollTop assignment only in scroll owner helpers", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file);
      if (rel.includes(".test.") || rel.includes("__tests__")) {
        continue;
      }
      if (SCROLL_TOP_WRITE_ALLOWLIST.has(rel)) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      // Assignment only (not property reads).
      if (
        /[^\w.]scrollTop\s*=/.test(source) ||
        /^\s*scrollTop\s*=/m.test(source)
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("documents gold-standard scroll ownership as the authority", () => {
    const design = readFileSync(
      join(
        REPO_ROOT,
        "docs/superpowers/specs/2026-08-10-file-tree-scroll-ownership-gold-standard.md"
      ),
      "utf8"
    );
    expect(design).toContain("G0–G5");
    expect(design).toContain("requestLayoutCompensate");
    expect(design).toContain("shouldCompensate");
  });

  it("removes restoreSnapshotSoon from the public controller surface", () => {
    const types = readFileSync(PUBLIC_CONTROLLER, "utf8");
    const controllerBlock = types.slice(
      types.indexOf("export interface PierFileTreeScrollController"),
      types.indexOf("export interface PierFileTreeProps")
    );
    expect(controllerBlock).not.toContain("restoreSnapshotSoon");
    expect(controllerBlock).not.toContain("lock?:");
    expect(controllerBlock).toContain("requestLayoutCompensate");
  });
});
