import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DEV_PROFILE_SCRIPT = readFileSync(
  join(process.cwd(), "scripts/dev-profile.mjs"),
  "utf8"
);
const SETUP_WORKTREE_SCRIPT = readFileSync(
  join(process.cwd(), "scripts/setup-worktree.mjs"),
  "utf8"
);

describe("native dev build staleness guards", () => {
  it("blocks pnpm dev when vendored GhosttyTerminal Swift sources are newer than runtime artifacts", () => {
    expect(DEV_PROFILE_SCRIPT).toContain(
      'path.join(nativeRoot, "Vendor", "libghostty-spm", "Sources")'
    );
    expect(DEV_PROFILE_SCRIPT).toContain("libGhosttyBridge.dylib");
    expect(DEV_PROFILE_SCRIPT).toContain("runtimeArtifactMtime");
    expect(DEV_PROFILE_SCRIPT).toContain(
      "旧 binary/dylib 会让 Electron 运行旧 native 代码"
    );
  });

  it("rebuilds worktree native artifacts when vendored Swift sources are stale", () => {
    expect(SETUP_WORKTREE_SCRIPT).toContain(
      'path.join(nativeRoot, "Vendor", "libghostty-spm", "Sources")'
    );
    expect(SETUP_WORKTREE_SCRIPT).toContain("libGhosttyBridge.dylib");
    expect(SETUP_WORKTREE_SCRIPT).toContain("staleNativeSource");
    expect(SETUP_WORKTREE_SCRIPT).toContain("native addon 过期");
  });
});
