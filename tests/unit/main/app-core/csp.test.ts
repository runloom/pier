import { buildCspPolicy, shouldApplyAppCsp } from "@main/csp.ts";
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

    // pier-file-preview is img-only; pier-live may share the same img-src line.
    expect(previewDirectives).toEqual([
      expect.stringMatching(/^img-src .* pier-file-preview:/u),
    ]);
    expect(
      directives.some(
        (directive) =>
          directive.startsWith("script-src ") &&
          directive.includes("pier-file-preview:")
      )
    ).toBe(false);
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
  it.each([
    true,
    false,
  ])("allows sandboxed html preview frames when dev=%s", (isDev) => {
    const directives = buildCspPolicy(isDev).split("; ");
    const frameSrc = directives.find((directive) =>
      directive.startsWith("frame-src ")
    );

    expect(frameSrc).toBe("frame-src 'self' pier-html-preview:");
    expect(
      directives.some(
        (directive) =>
          directive.startsWith("script-src ") &&
          directive.includes("pier-html-preview:")
      )
    ).toBe(false);
  });

  it("exempts only the html preview scheme from the host CSP override", () => {
    expect(shouldApplyAppCsp("pier-html-preview://preview/ticket/a.html")).toBe(
      false
    );
    expect(shouldApplyAppCsp("https://example.com/index.html")).toBe(true);
    expect(shouldApplyAppCsp("file:///Applications/pier/index.html")).toBe(
      true
    );
  });
});
