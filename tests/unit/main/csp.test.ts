import { buildCspPolicy } from "@main/csp.ts";
import { describe, expect, it } from "vitest";

describe("buildCspPolicy", () => {
  it.each([
    true,
    false,
  ])("allows file previews only as images when dev=%s", (isDev) => {
    const directives = buildCspPolicy(isDev).split("; ");
    const previewDirectives = directives.filter((directive) =>
      directive.includes("pier-file-preview:")
    );

    expect(previewDirectives).toEqual([
      expect.stringMatching(/^img-src .* pier-file-preview:$/),
    ]);
  });

  it("allows Shiki wasm compilation without production unsafe-eval", () => {
    const production = buildCspPolicy(false);
    const development = buildCspPolicy(true);
    const productionScriptSrc = production
      .split("; ")
      .find((directive) => directive.startsWith("script-src "));
    const developmentScriptSrc = development
      .split("; ")
      .find((directive) => directive.startsWith("script-src "));

    expect(productionScriptSrc).toContain("'wasm-unsafe-eval'");
    expect(productionScriptSrc).not.toContain("'unsafe-eval'");
    expect(developmentScriptSrc).toContain("'wasm-unsafe-eval'");
    expect(developmentScriptSrc).toContain("'unsafe-eval'");
  });
});
