import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SPEC =
  "docs/superpowers/specs/2026-11-12-files-document-preview-gold-standard.md";
const PREVIEW = "src/plugins/builtin/files/renderer/preview";
const DOCUMENT = `${PREVIEW}/document`;
const DOCX = `${PREVIEW}/docx`;
const PDF = `${PREVIEW}/pdf`;
const XLSX = `${PREVIEW}/xlsx`;

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function sourceFiles(dir: string): string[] {
  const absolute = join(ROOT, dir);
  const files: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const path = join(absolute, entry);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(relative(ROOT, path).split(sep).join("/")));
    } else if (/\.(ts|tsx)$/u.test(entry)) {
      files.push(relative(ROOT, path).split(sep).join("/"));
    }
  }
  return files;
}

describe("files document preview gold standard", () => {
  it("documents the contract in the spec and AGENTS.md", () => {
    const spec = read(SPEC);
    const agents = read("AGENTS.md");

    expect(spec).toContain("PDF / DOCX / XLSX");
    expect(spec).toContain("64 MiB");
    expect(spec).toContain("pier-file-preview://");
    expect(spec).toContain("worker-src");
    expect(agents).toContain("### Files 文档预览（PDF / DOCX / XLSX）");
    expect(agents).toContain(
      "tests/unit/plugins/files/document-preview-governance.test.ts"
    );
  });

  it("lazy-loads each document renderer", () => {
    const source = read(`${DOCUMENT}/index.tsx`);

    expect(source).toContain('lazy(() => import("../pdf/index.tsx"))');
    expect(source).toContain('lazy(() => import("../docx/index.tsx"))');
    expect(source).toContain('lazy(() => import("../xlsx/index.tsx"))');
    expect(source).not.toMatch(/^import\s+FilePdfPreview/mu);
    expect(source).not.toMatch(/^import\s+FileDocxPreview/mu);
    expect(source).not.toMatch(/^import\s+FileXlsxPreview/mu);
  });

  it("serves PDF assets and workers through packaged-safe URLs", () => {
    const source = read(`${PDF}/use-document.ts`);

    expect(source).toContain('cMapUrl: "pier-asset://pdfjs/cmaps/"');
    expect(source).toContain(
      'standardFontDataUrl: "pier-asset://pdfjs/standard_fonts/"'
    );
    expect(source).toContain('wasmUrl: "pier-asset://pdfjs/wasm/"');
    expect(source).toContain("pdf.worker.min.mjs?worker&inline");
    expect(source).not.toContain("unsafe-eval");
    expect(read(`${XLSX}/worker-client.ts`)).toContain(
      "./worker.ts?worker&inline"
    );
  });

  it("keeps document rendering sanitized and Shadow-DOM based", () => {
    const sanitize = read(`${DOCX}/sanitize.ts`);

    for (const tag of [
      "script",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "form",
    ]) {
      expect(sanitize).toContain(`"${tag}"`);
    }
    expect(sanitize).toContain('name.startsWith("on")');
    // Render into detached nodes; the component sanitizes before committing
    // and only after its cancellation check, so stale renders cannot leak.
    const render = read(`${DOCX}/render.ts`);
    expect(render).toContain('document.createElement("div")');
    expect(render).not.toContain("attachShadow");
    const docx = read(`${DOCX}/index.tsx`);
    expect(docx).toContain('attachShadow({ mode: "open" })');
    expect(docx.indexOf("sanitizeDocxShadow(content)")).toBeLessThan(
      docx.indexOf("shadow.replaceChildren")
    );

    for (const dir of [DOCUMENT, DOCX, PDF, XLSX]) {
      for (const file of sourceFiles(dir)) {
        expect(read(file)).not.toContain("dangerouslySetInnerHTML");
      }
    }
  });

  it("pins spreadsheet safety limits and the official SheetJS package", () => {
    const limits = read(`${XLSX}/limits.ts`);
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
    };

    expect(limits).toContain("maxRows: 50_000");
    expect(limits).toContain("maxColumns: 256");
    expect(limits).toContain("maxCells: 500_000");
    // The exact pin keeps worker/API/asset behavior reproducible.
    expect(pkg.dependencies["pdfjs-dist"]).toBe("6.5.438");
    expect(pkg.dependencies["docx-preview"]).toBeTruthy();
    expect(pkg.dependencies.jszip).toBeTruthy();
    expect(pkg.dependencies.xlsx).toMatch(/^https:\/\/cdn\.sheetjs\.com\//u);
    expect(pkg.dependencies.xlsx).not.toContain("0.18");
  });

  it("ships PDF.js assets and opens CSP for document bytes and workers", () => {
    const builder = read("electron-builder.yml");
    const csp = read("src/main/csp.ts");

    expect(builder).toContain("pdfjs/cmaps");
    expect(builder).toContain("pdfjs/standard_fonts");
    expect(builder).toContain("pdfjs/wasm");
    expect(
      csp.match(/connect-src[^"]*pier-file-preview:[^"]*pier-asset:/gu)
    ).toHaveLength(2);
    expect(csp.match(/worker-src 'self' blob:/gu)).toHaveLength(2);
  });

  it("stays read-only and outside the workspace layout runtime", () => {
    const forbidden = [
      "editor/controller",
      "git-changes",
      "comments/",
      "dockview",
      "/save",
    ];
    for (const dir of [DOCUMENT, DOCX, PDF, XLSX]) {
      for (const file of sourceFiles(dir)) {
        const source = read(file);
        for (const marker of forbidden) {
          expect(source).not.toContain(marker);
        }
      }
    }
  });

  it("does not suppress type errors in the new preview code", () => {
    for (const dir of [
      DOCUMENT,
      DOCX,
      PDF,
      XLSX,
      "src/plugins/builtin/files/renderer/panel/preview",
    ]) {
      for (const file of sourceFiles(dir)) {
        const source = read(file);
        expect(source).not.toContain("@ts-ignore");
        expect(source).not.toContain("@ts-expect-error");
        expect(source).not.toMatch(/\bas\s+any\b/u);
      }
    }
  });
});
