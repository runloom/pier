import { buildCspPolicy, shouldApplyAppCsp } from "@main/csp.ts";
import { describe, expect, it } from "vitest";

describe("buildCspPolicy", () => {
  it.each([
    true,
    false,
  ])("routes file preview bytes through img-src and connect-src when dev=%s", (isDev) => {
    const directives = buildCspPolicy(isDev).split("; ");
    const imgSrc = directives.find((directive) =>
      directive.startsWith("img-src ")
    );
    const connectSrc = directives.find((directive) =>
      directive.startsWith("connect-src ")
    );
    const frameSrc = directives.find((directive) =>
      directive.startsWith("frame-src ")
    );

    expect(imgSrc).toContain("pier-file-preview:");
    expect(connectSrc).toContain("pier-file-preview:");
    expect(connectSrc).toContain("pier-asset:");
    expect(frameSrc).not.toContain("pier-file-preview:");
    expect(frameSrc).not.toContain("pier-asset:");
    expect(
      directives.some(
        (directive) =>
          directive.startsWith("script-src ") &&
          directive.includes("pier-file-preview:")
      )
    ).toBe(false);
  });

  it.each([
    true,
    false,
  ])("allows blob workers for document parsers when dev=%s", (isDev) => {
    const workerSrc = buildCspPolicy(isDev)
      .split("; ")
      .find((directive) => directive.startsWith("worker-src "));

    expect(workerSrc).toBe("worker-src 'self' blob:");
  });

  it("allows loopback connect-src in both modes without https or a bare host wildcard", () => {
    for (const isDev of [true, false]) {
      const connectSrc = buildCspPolicy(isDev)
        .split("; ")
        .find((directive) => directive.startsWith("connect-src "));
      expect(connectSrc, `dev=${isDev}`).toBeDefined();
      expect(connectSrc).toContain("http://localhost:*");
      expect(connectSrc).toContain("http://127.0.0.1:*");
      expect(connectSrc).not.toMatch(/\bhttps:/u);
      expect(connectSrc).not.toMatch(/(?:^|\s)\*(?:\s|;|$)/u);
    }
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
