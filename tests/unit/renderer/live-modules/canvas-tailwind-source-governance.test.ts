// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendScopedCssInjector } from "../../../../src/main/services/live-modules/css-inject.ts";
import {
  CANVAS_TAILWIND_DARK_VARIANT,
  CANVAS_TAILWIND_INPUT_CSS,
  splitTailwindPropertyRules,
} from "../../../../src/main/services/live-modules/tailwind.ts";

/**
 * Canvas Tailwind governance (design §4.1 / plan T2.3–T2.4).
 *
 * Canvas utility CSS comes from the runtime JIT in
 * src/main/services/live-modules/tailwind.ts — one pipeline for repo canvases
 * and user-project canvases. The host bundle must not re-grow a build-time
 * `@source` for canvases, and the JIT output must stay scoped to the canvas
 * shell with no global selector escape.
 */

const PROPERTY_RULE_RE = /@property\s+[^{}]*\{[^{}]*\}/gu;

function readGlobalsCss(): string {
  return readFileSync(
    join(process.cwd(), "src/renderer/app/globals.css"),
    "utf8"
  );
}

function readCompileSource(): string {
  return readFileSync(
    join(process.cwd(), "src/main/services/live-modules/compile.ts"),
    "utf8"
  );
}

/** The injected stylesheet payload embedded by the injector snippet. */
function extractInjectedPayload(jsSource: string): string {
  const match = jsSource.match(/s\.textContent = ("(?:[^"\\]|\\.)*");/u);
  expect(match, "injector must embed a JSON string payload").toBeTruthy();
  return JSON.parse(match?.[1] ?? '""') as string;
}

describe("canvas Tailwind governance", () => {
  it("host globals.css has no build-time @source for canvases", () => {
    const css = readGlobalsCss();
    expect(css).not.toMatch(/@source\s+"[^"]*\.pier\/canvases/u);
    // Guard against over-deletion: host-owned sources stay.
    expect(css).toMatch(/@source\s+"\.\.\/\.\.\/\.\.\/packages\/ui\/src"/u);
    expect(css).toMatch(/@source\s+"\.\.\/\.\.\/plugins"/u);
  });

  it("compile pipeline feeds JIT output through the scoped injector", () => {
    const source = readCompileSource();
    expect(source).toMatch(/buildCanvasTailwindCss\(/u);
    expect(source).toMatch(/\[cssText, tailwind\.css\]/u);
    expect(source).toMatch(
      /appendScopedCssInjector\(\s*jsText,\s*mergedCss,\s*input\.moduleId,\s*tailwind\.propertyCss\s*\)/u
    );
  });

  it("JIT input compiles utilities only — no theme variable layer", () => {
    // `reference` = never emit theme variables (host globals.css owns them);
    // `inline` = default palette values are inlined, so canvases work in
    // projects without their own Tailwind install.
    expect(
      CANVAS_TAILWIND_INPUT_CSS.match(/theme\(inline reference\)/gu)
    ).toHaveLength(2);
    // Scan set is the compile graph — no Tailwind source auto-detection.
    expect(CANVAS_TAILWIND_INPUT_CSS).toContain(
      "@tailwind utilities source(none);"
    );
    const tailwind = readFileSync(
      join(process.cwd(), "src/main/services/live-modules/tailwind.ts"),
      "utf8"
    );
    expect(tailwind).toContain("does not emit `@keyframes`");
  });

  it("JIT dark variant stays byte-identical with the host globals.css", () => {
    expect(readGlobalsCss()).toContain(CANVAS_TAILWIND_DARK_VARIANT);
  });

  it("selector rules stay inside @scope; only @property rides unscoped", () => {
    const propertyCss = '@property --tw-x { syntax: "*"; inherits: false; }';
    const out = appendScopedCssInjector(
      "export {};",
      ":root { --x: 1; }\n.a { color: red; }",
      "governance-module",
      propertyCss
    );
    const payload = extractInjectedPayload(out);
    expect(payload.startsWith("@scope ([data-pier-canvas-shell]) {")).toBe(
      true
    );

    const tailIndex = payload.indexOf("@property");
    expect(tailIndex).toBeGreaterThan(-1);
    const scopedPart = payload.slice(0, tailIndex);
    const unscopedTail = payload.slice(tailIndex);

    // Selector rules (even :root) are enclosed by the @scope block.
    expect(scopedPart).toContain(":root { --x: 1; }");
    const opens = scopedPart.match(/\{/gu)?.length ?? 0;
    const closes = scopedPart.match(/\}/gu)?.length ?? 0;
    expect(opens).toBe(closes);

    // The unscoped tail carries nothing but @property registrations.
    expect(unscopedTail.replace(PROPERTY_RULE_RE, "").trim()).toBe("");
  });

  it("injector without property css emits a fully scoped payload", () => {
    const out = appendScopedCssInjector(
      "export {};",
      ".a { color: red; }",
      "governance-module"
    );
    const payload = extractInjectedPayload(out);
    expect(payload.trimStart().startsWith("@scope")).toBe(true);
    expect(payload.trimEnd().endsWith("}")).toBe(true);
  });

  it("property splitter never moves selector rules out of scope", () => {
    const { css, propertyCss } = splitTailwindPropertyRules(
      `:root { --leak: 1; }\nbody { margin: 0; }\n@property --tw-y { syntax: "*"; inherits: false; }`
    );
    expect(css).toContain(":root");
    expect(css).toContain("body");
    expect(propertyCss.replace(PROPERTY_RULE_RE, "").trim()).toBe("");
  });
});
