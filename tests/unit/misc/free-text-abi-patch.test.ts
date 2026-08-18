import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PATCH = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Patches/ghostty/0106-free-text-abi.patch"
);
const README = join(
  process.cwd(),
  "native/Vendor/libghostty-spm/Patches/ghostty/README.md"
);

describe("ghostty free_text ABI patch", () => {
  it("backports the two-argument C signature so dumpTextLocked buffers are freed", () => {
    const patch = readFileSync(PATCH, "utf8");
    expect(patch).toContain(
      "-    export fn ghostty_surface_free_text(ptr: *Text) void {"
    );
    expect(patch).toContain(
      "+    export fn ghostty_surface_free_text(_: *Surface, ptr: *Text) void {"
    );
    expect(readFileSync(README, "utf8")).toContain("0106-free-text-abi.patch");
  });
});
