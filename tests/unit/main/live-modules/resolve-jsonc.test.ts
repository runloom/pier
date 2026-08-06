import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadTsconfigPaths,
  stripJsonc,
} from "../../../../src/main/services/live-modules/resolve.ts";

describe("live-modules resolve stripJsonc", () => {
  it("strips trailing comments on code lines", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-jsonc-"));
    const srcDir = join(projectRoot, "src");
    await mkdir(srcDir, { recursive: true });
    // The `// trailing comment` after the value would break JSON.parse without
    // comment stripping (the old regex DID handle this correctly).
    await writeFile(
      join(projectRoot, "tsconfig.json"),
      [
        "{",
        "  // leading comment",
        '  "compilerOptions": {',
        '    "baseUrl": ".",',
        '    "paths": {',
        '      "@/*": ["./src/*"] // trailing comment',
        "    }",
        "  }",
        "}",
      ].join("\n")
    );
    const config = loadTsconfigPaths(srcDir, projectRoot);
    expect(config).not.toBeNull();
    if (!config) {
      return;
    }
    expect(config.paths["@/*"]).toEqual(["./src/*"]);
  });

  it("preserves // inside string values (old regex truncated at line-anchored //)", () => {
    const stripped = stripJsonc(
      [
        "{",
        '  "compilerOptions": {',
        '    "baseUrl": "https://example.com",',
        "  }",
        "}",
      ].join("\n")
    );
    // The full URL must survive comment stripping.
    expect(stripped).toContain("https://example.com");
    expect(JSON.parse(stripped).compilerOptions.baseUrl).toBe(
      "https://example.com"
    );
  });

  it("does not strip ,} / ,] sequences inside string values", () => {
    const stripped = stripJsonc(
      ['{ "description": "see https://x,}", "ok": true }'].join("\n")
    );
    expect(JSON.parse(stripped).description).toBe("see https://x,}");
    expect(JSON.parse(stripped).ok).toBe(true);
  });

  it("still strips real trailing commas outside strings", () => {
    const stripped = stripJsonc(['{ "a": 1, "b": 2, }'].join("\n"));
    expect(JSON.parse(stripped)).toEqual({ a: 1, b: 2 });
  });
});
