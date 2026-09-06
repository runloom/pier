import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PATCH_ID = "0111-utf8-safe-pty-write-chunk";
const PATCH = `native/Vendor/libghostty-spm/Patches/ghostty/${PATCH_ID}.patch`;
const PATCH_README = "native/Vendor/libghostty-spm/Patches/ghostty/README.md";
const SUBMIT_TEXT = "src/main/ipc/terminal/submit-text.ts";
const THIS_TEST =
  "tests/unit/native/terminal-pty-write-utf8-boundary-governance.test.ts";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Added lines of the patch (leading `+` stripped), in order. */
function addedLines(patch: string): string[] {
  return patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
}

/**
 * The helper + its Zig tests as they appear in the patch, so they can be
 * compiled standalone. Starts at the Pier doc comment and stops before the
 * first context line that follows the added block (`fn ttyWrite(`).
 */
function extractZigHelper(patch: string): string {
  const lines = patch.split("\n");
  const start = lines.findIndex((line) =>
    line.startsWith("+/// Pier patch (0111)")
  );
  expect(start).toBeGreaterThan(-1);
  const body: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.startsWith("+")) {
      body.push(line.slice(1));
      continue;
    }
    break;
  }
  return body.join("\n");
}

/** Same lookup order as scripts/build-libghostty.sh; null when no zig 0.15. */
function findZig015(): string | null {
  const candidates = [
    process.env.ZIG,
    "/opt/homebrew/opt/zig@0.15/bin/zig",
    "/usr/local/opt/zig@0.15/bin/zig",
    "zig",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      const version = execFileSync(candidate, ["version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      }).trim();
      if (version.startsWith("0.15.")) {
        return candidate;
      }
    } catch {
      // not installed / wrong version → try the next candidate
    }
  }
  return null;
}

describe("terminal pty write UTF-8 boundary (patch 0111)", () => {
  it("documents the rule in AGENTS.md and the patch README", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain(
      "### 终端 PTY 写入 UTF-8 边界 `0111-utf8-safe-pty-write-chunk`"
    );
    expect(agents).toContain(THIS_TEST);
    expect(agents).toContain("utf8ChunkEnd");
    expect(agents).toContain("禁止在 renderer / main 侧绕");

    const readme = read(PATCH_README);
    expect(readme).toContain(`${PATCH_ID}.patch`);
    expect(readme).toContain("utf8ChunkEnd");
  });

  it("ships the patch against Exec.queueWrite with both chunk paths aligned", () => {
    expect(existsSync(join(ROOT, PATCH))).toBe(true);
    const patch = read(PATCH);
    expect(patch).toContain(
      "diff --git a/src/termio/Exec.zig b/src/termio/Exec.zig"
    );

    const added = addedLines(patch).join("\n");
    expect(added).toContain(
      "fn utf8ChunkEnd(data: []const u8, start: usize, end: usize) usize {"
    );
    expect(added).toContain("return (byte & 0xC0) == 0x80;");
    // Fast path: the boundary is resolved before the copy.
    expect(added).toContain(
      "const max = utf8ChunkEnd(data, i, @min(data.len, i + buf.len));"
    );
    // Linefeed path: give the split scalar back after the CRLF expansion.
    expect(added).toContain(
      "const aligned = utf8ChunkEnd(data, chunk_start, i);"
    );
    expect(added).toContain("buf_i -= i - aligned;");
    // Never stall: end of data, malformed input and empty chunks fall back.
    expect(added).toContain("if (end == data.len) return end;");
    expect(added).toContain("if (back == 3 or cut <= start + 1) return end;");
    // Only the boundary changes; the 64-byte pool is untouched.
    expect(patch).not.toContain("SegmentedPool([");
    expect(patch).not.toContain("-        const buf = try exec.write_buf_pool");
  });

  it("carries Zig tests for the split cases that produced U+FFFD", () => {
    const added = addedLines(read(PATCH)).join("\n");
    expect(added).toContain(
      'test "utf8ChunkEnd never splits a multi-byte scalar"'
    );
    expect(added).toContain(
      'test "utf8ChunkEnd falls back to the byte boundary on malformed input"'
    );
    // 63 ASCII bytes + a 3-byte scalar: the exact 1+2 / 2+1 splits seen live.
    expect(added).toContain('const cjk = "a" ** 63 ++ "呢" ++ "?";');
    expect(added).toContain("utf8ChunkEnd(cjk, 0, 64)");
    expect(added).toContain("utf8ChunkEnd(cjk, 0, 65)");
    expect(added).toContain("utf8ChunkEnd(emoji, 0, 64)");
  });

  it("keeps the host sending the whole body in one sendText (no renderer-side workaround)", () => {
    const source = read(SUBMIT_TEXT);
    expect(source).toContain(
      "const textOk = args.addon.sendText(args.nativePanelId, args.text);"
    );
    expect(source).not.toMatch(/for \(const \w+ of args\.text\)/u);
    expect(source).not.toMatch(/args\.text\.(?:slice|substring|match)\(/u);
  });

  const zig = findZig015();
  it.skipIf(zig === null)(
    "compiles and passes the patch's own Zig tests with zig 0.15",
    { timeout: 130_000 },
    () => {
      const helper = extractZigHelper(read(PATCH));
      const dir = mkdtempSync(join(tmpdir(), "pier-0111-"));
      const file = join(dir, "utf8_chunk_end.zig");
      writeFileSync(
        file,
        `const std = @import("std");\nconst assert = std.debug.assert;\n\n${helper}\n`
      );
      // zig reports test progress on stderr.
      const result = spawnSync(zig as string, ["test", file], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status, output).toBe(0);
      expect(output).toContain("All 3 tests passed.");
    }
  );
});
