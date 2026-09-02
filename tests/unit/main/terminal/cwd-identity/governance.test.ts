import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-09-02-terminal-git-identity-gold-standard.md";
const AGENTS = "AGENTS.md";
const FORWARDING = "src/main/ipc/terminal/cwd-forwarding.ts";
const DISCOVERY = "src/main/services/git/identity-discovery.ts";
const DIGEST = "src/main/services/panel-context-identity.ts";
const SHARED = "src/plugins/builtin/git/renderer/status-item-shared.ts";
const TRANSFER = "src/main/ipc/terminal/transfer-guards.ts";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("terminal git-identity gold standard", () => {
  it("documents the contract in AGENTS.md and the spec", () => {
    const agents = read(AGENTS);
    const spec = read(SPEC);
    expect(existsSync(join(ROOT, SPEC))).toBe(true);
    expect(agents).toContain("### 终端面板 git 身份");
    expect(agents).toContain(
      "tests/unit/main/terminal/cwd-identity/governance.test.ts"
    );
    expect(spec).toContain("一句话终态");
    expect(spec).toContain("resolvePanelContextForPath");
    expect(spec).toContain("panelGitIdentityDigest");
    expect(spec).toContain("gitIdentityWatchDirectories");
    expect(spec).toContain("onDirty");
    expect(spec).toContain("filename == null");
    expect(spec).toContain("releaseTerminalCwdForwarding");
    expect(spec).toContain("bump 代际");
  });

  it("resolves identity only through the panel context resolver", () => {
    const forwarding = read(FORWARDING);
    expect(forwarding).toContain("resolvePanelContextForPath");
    expect(forwarding).toContain("panelGitIdentityDigest");
    expect(forwarding).toContain("emittedDigest");
    expect(forwarding).toContain("needsEmitDigest");
    expect(forwarding).toContain("pendingInvalidation");
    expect(forwarding).toContain("onDirty");
    expect(forwarding).not.toContain("GIT_IDENTITY_RETRY_MS");
    expect(forwarding).not.toContain("cwdHasGitDir");
    expect(forwarding).not.toContain("setTerminalCwdHasGitDirProbeForTests");
    expect(forwarding).not.toContain('join(cwd, ".git")');
    expect(forwarding).not.toContain("hasGitIdentity");
  });

  it("treats .git watches as invalidation, not identity", () => {
    const discovery = read(DISCOVERY);
    expect(discovery).toContain("gitIdentityWatchDirectories");
    expect(discovery).toContain("shouldInvalidateGitIdentityWatch");
    expect(discovery).toContain("onDirty");
    expect(discovery).toContain('"error"');
    expect(discovery).not.toContain("resolvePanelContextForPath");
    expect(discovery).not.toContain("rev-parse");
    const digest = read(DIGEST);
    expect(digest).toContain("updatedAt");
    expect(digest).toContain("gitRoot");
  });

  it("gates status-bar chips on gitRoot only", () => {
    const shared = read(SHARED);
    expect(shared).toContain("panelContext?.gitRoot");
    expect(shared).not.toMatch(/gitIdentityRoot[\s\S]*worktreeRoot/);
    expect(shared).toMatch(
      /isDistinctWorktree:\s*Boolean\(\s*context\?\.gitRoot &&/
    );
  });

  it("releases git identity on transfer source close and keeps it on relaunch", () => {
    const transfer = read(TRANSFER);
    expect(transfer).toMatch(
      /acknowledgeSourceCloseIdempotent[\s\S]*?releaseTerminalCwdForwarding[\s\S]*?return true/
    );
    expect(transfer).toContain('options?.reason !== "relaunch"');
  });
});
