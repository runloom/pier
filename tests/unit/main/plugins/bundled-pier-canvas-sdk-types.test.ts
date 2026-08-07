// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PIER_CANVAS_COMPONENT_EXPORT_NAMES,
  PIER_CANVAS_VALUE_EXPORT_NAMES,
} from "@shared/pier-canvas-export-names.ts";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SDK_DIR = resolve(
  process.cwd(),
  "resources/system-skills/pier-canvas/sdk"
);

/** Every focused declaration file plus the barrel (index.d.ts last). */
function sdkDeclarationFiles(): string[] {
  return readdirSync(SDK_DIR)
    .filter((f) => f.endsWith(".d.ts"))
    .sort((a, b) => {
      if (a === "index.d.ts") {
        return 1;
      }
      if (b === "index.d.ts") {
        return -1;
      }
      return a.localeCompare(b);
    })
    .map((f) => join(SDK_DIR, f));
}

function sdkSource(): string {
  return sdkDeclarationFiles()
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

/**
 * Compile every SDK declaration with `skipLibCheck: false` so unresolved
 * names (TS2304) and duplicate exports (TS2308) surface as real errors.
 */
function sdkTypeErrors(): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2020.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    types: ["react"],
    esModuleInterop: true,
  };
  const program = ts.createProgram(sdkDeclarationFiles(), options);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.category === ts.DiagnosticCategory.Error);
}

function formatDiagnostic(d: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
  const fileName = d.file?.fileName ?? "?";
  if (!d.file || d.start === undefined) return `${fileName}: ${message}`;
  const pos = d.file.getLineAndCharacterOfPosition(d.start);
  return `${fileName}:${pos.line + 1}:${pos.character + 1} ${message}`;
}

describe("bundled pier-canvas SDK types", () => {
  it("primitives.d.ts exists and is valid TypeScript", () => {
    const source = readFileSync(join(SDK_DIR, "primitives.d.ts"), "utf8");
    expect(source.length).toBeGreaterThan(0);
    // No double semicolons (serialization artifact)
    expect(source).not.toMatch(/;;/u);
  });

  it("declares every component export with a typed signature", () => {
    const source = sdkSource();
    for (const name of PIER_CANVAS_COMPONENT_EXPORT_NAMES) {
      // Curated components may live in any focused SDK file (core/forms/
      // visualizations), but never as the untyped CanvasPrimitive fallback.
      const re = new RegExp(`export const ${name}: (?!CanvasPrimitive;)`, "u");
      expect(source, `missing typed declaration for ${name}`).toMatch(re);
    }
  });

  it("does not fall back to the generic CanvasPrimitive for real components", () => {
    const source = readFileSync(join(SDK_DIR, "primitives.d.ts"), "utf8");
    // CanvasPrimitive is the fallback type; real components should use
    // concrete prop types (HTMLAttributes, inline objects, etc.)
    const fallbackCount = (source.match(/: CanvasPrimitive;/gu) ?? []).length;
    expect(fallbackCount).toBe(0);
  });

  it("declares every value export with a function signature", () => {
    const source = sdkSource();
    for (const name of PIER_CANVAS_VALUE_EXPORT_NAMES) {
      const re = new RegExp(`export (?:const ${name}:|function ${name}\\()`);
      expect(source, `missing function declaration for ${name}`).toMatch(re);
    }
  });

  it("does not duplicate exports with sibling SDK files", () => {
    const seen = new Map<string, string[]>();
    for (const file of sdkDeclarationFiles()) {
      if (file.endsWith("index.d.ts")) continue;
      const text = readFileSync(file, "utf8");
      const base = file.slice(file.lastIndexOf("/") + 1);
      for (const match of text.matchAll(/^export (?:const|function) (\w+)/gm)) {
        const name = match[1];
        if (!name) continue;
        const list = seen.get(name) ?? [];
        list.push(base);
        seen.set(name, list);
      }
    }
    const duplicates = [...seen.entries()].filter(
      ([, files]) => files.length > 1
    );
    expect(duplicates).toEqual([]);
  });

  // Full TypeScript Program construction under coverage is slower than unit
  // default (5s); CI coverage job timed out at the default budget.
  it("type-checks every SDK declaration with skipLibCheck disabled", () => {
    const errors = sdkTypeErrors();
    const formatted = errors.map(formatDiagnostic).join("\n");
    expect(
      formatted,
      "SDK declarations must be self-contained under skipLibCheck:false:\n" +
        formatted
    ).toBe("");
  }, 60_000);
});
