import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import type { LiveModuleDiagnostic } from "@shared/contracts/live-modules.ts";
import type { Metafile } from "esbuild";

/**
 * Canvas Tailwind runtime JIT.
 *
 * Canvases compile at runtime (esbuild), so their utility classes never pass
 * through the host's build-time Tailwind scan. This module scans the compiled
 * entry + dependency graph sources with the oxide scanner and builds utility
 * CSS with the embedded Tailwind v4 compiler. The output merges into the
 * existing scoped CSS injector (`appendScopedCssInjector`), so utilities are
 * torn down with the module like any other canvas CSS.
 *
 * Theme contract: both theme imports use `theme(inline reference)` — no
 * variable layer is ever emitted. Default palette utilities inline their
 * literal color values; semantic tokens stay `var(--background)` references
 * resolved from the host globals.css at runtime. Semantic classes and
 * arbitrary-value classes both work in any project without a Tailwind
 * install.
 *
 * Known limit: `theme(inline reference)` does not emit `@keyframes`.
 * `animate-*` utilities only move if the host `globals.css` already
 * defines that animation.
 */

type TailwindNodeModule = typeof import("@tailwindcss/node");
type TailwindOxideModule = typeof import("@tailwindcss/oxide");
type TailwindCompiler = Awaited<ReturnType<TailwindNodeModule["compile"]>>;
type TailwindCompileOptions = Parameters<TailwindNodeModule["compile"]>[1];

/** Hot-path budget; overruns degrade the scan set (design §4.1 / plan T2.2). */
export const CANVAS_TAILWIND_HOT_BUDGET_MS = 100;

/**
 * Must stay byte-identical with the `@variant dark` line in
 * src/renderer/app/globals.css — canvas `dark:` utilities have to follow the
 * host's class-based theme switch, not `prefers-color-scheme`.
 * Governance-locked by canvas-tailwind-source-governance.
 */
export const CANVAS_TAILWIND_DARK_VARIANT =
  "@variant dark (:root:not(.light) &);";

/**
 * `theme(inline reference)` = use theme values for candidate matching but
 * never emit the variable layer (host globals.css owns runtime variables).
 * `source(none)` disables Tailwind's own source auto-detection — the scan set
 * is the compile dependency graph, provided explicitly to the oxide scanner.
 */
export const CANVAS_TAILWIND_INPUT_CSS = `@import "tailwindcss/theme.css" theme(inline reference);
@import "@pier/ui/tailwind-theme.css" theme(inline reference);
${CANVAS_TAILWIND_DARK_VARIANT}
@tailwind utilities source(none);
`;

/**
 * tailwindcss `Polyfills.ColorMix` (const enum — member access is blocked by
 * isolatedModules). Keeps color-mix fallbacks but skips the `@layer
 * properties` @property fallback block: Electron is Chromium-only, and that
 * block carries universal selectors which must not leave the canvas scope.
 */
const CHROMIUM_POLYFILLS = 2 as NonNullable<
  TailwindCompileOptions["polyfills"]
>;

/** Source kinds the oxide scanner should extract candidates from. */
const SCAN_EXTENSIONS = new Set([
  "cjs",
  "js",
  "jsx",
  "mjs",
  "svelte",
  "ts",
  "tsx",
  "vue",
]);

/**
 * Per-esbuild-context cache. Stored on `CompileContextEntry`, so it lives and
 * dies with the context by construction — no separate invalidation plumbing.
 */
export interface CanvasTailwindCacheSlot {
  compilerPromise?: Promise<TailwindCompiler> | undefined;
  css?: string | undefined;
  /** True when the cached css came from a degraded (entry + direct) scan. */
  cssDegraded?: boolean | undefined;
  /** Sticky: once the hot path overruns, later rebuilds scan the reduced set. */
  degradeScan?: boolean | undefined;
  fileSetHash?: string | undefined;
  propertyCss?: string | undefined;
}

export function createCanvasTailwindCacheSlot(): CanvasTailwindCacheSlot {
  return {};
}

export interface CanvasTailwindInput {
  cacheSlot: CanvasTailwindCacheSlot;
  entryAbsolutePath: string;
  /** Absolute paths of the entry's direct imports (degraded scan set). */
  entryDirectImports: readonly string[];
  fenceRoot: string;
  /** Compiled graph, relative to fenceRoot (esbuild resolve tracking). */
  graphRelativePaths: Iterable<string>;
  /** Test hook — budget override (defaults to CANVAS_TAILWIND_HOT_BUDGET_MS). */
  hotBudgetMs?: number | undefined;
}

export interface CanvasTailwindOutput {
  /** Utility CSS for the scoped injector ("" when none or on failure). */
  css: string;
  diagnostics: LiveModuleDiagnostic[];
  /** Scan + build time, excluding one-time compiler creation. */
  durationMs: number;
  fromCache: boolean;
  /** Top-level `@property` rules — invalid inside `@scope`, injected unscoped. */
  propertyCss: string;
  usedDegradedScan: boolean;
}

const moduleRequire = createRequire(import.meta.url);

let tailwindNodePromise: Promise<TailwindNodeModule> | null = null;
function loadTailwindNode(): Promise<TailwindNodeModule> {
  tailwindNodePromise ??= import("@tailwindcss/node");
  return tailwindNodePromise;
}

let oxidePromise: Promise<TailwindOxideModule> | null = null;
function loadOxide(): Promise<TailwindOxideModule> {
  oxidePromise ??= import("@tailwindcss/oxide");
  return oxidePromise;
}

/**
 * Both stylesheets resolve from the HOST install (app node_modules /
 * packages), never from the user's project — canvases must not require a
 * project-side Tailwind install.
 */
function resolveThemeCssPath(id: string): string | undefined {
  if (id === "tailwindcss/theme.css" || id === "@pier/ui/tailwind-theme.css") {
    return moduleRequire.resolve(id);
  }
  return;
}

async function createCompiler(baseDir: string): Promise<TailwindCompiler> {
  const tailwind = await loadTailwindNode();
  return await tailwind.compile(CANVAS_TAILWIND_INPUT_CSS, {
    base: baseDir,
    customCssResolver: (id) => Promise.resolve(resolveThemeCssPath(id)),
    // Theme files are host-owned and static per app version — not watched.
    onDependency: () => undefined,
    polyfills: CHROMIUM_POLYFILLS,
  });
}

function getCompiler(
  slot: CanvasTailwindCacheSlot,
  baseDir: string
): Promise<TailwindCompiler> {
  slot.compilerPromise ??= createCompiler(baseDir);
  return slot.compilerPromise;
}

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function scanExtension(absolutePath: string): string | null {
  const normalized = normalizeSlashes(absolutePath);
  if (normalized.includes("/node_modules/")) {
    return null;
  }
  const dot = normalized.lastIndexOf(".");
  if (dot === -1) {
    return null;
  }
  const extension = normalized.slice(dot + 1).toLowerCase();
  return SCAN_EXTENSIONS.has(extension) ? extension : null;
}

function collectScanFiles(input: CanvasTailwindInput): string[] {
  const seen = new Set<string>([normalizeSlashes(input.entryAbsolutePath)]);
  const files = [input.entryAbsolutePath];
  for (const rel of input.graphRelativePaths) {
    const absolute = join(input.fenceRoot, rel);
    const key = normalizeSlashes(absolute);
    if (seen.has(key) || scanExtension(absolute) === null) {
      continue;
    }
    seen.add(key);
    files.push(absolute);
  }
  return files;
}

function collectDegradedScanFiles(input: CanvasTailwindInput): string[] {
  const seen = new Set<string>([normalizeSlashes(input.entryAbsolutePath)]);
  const files = [input.entryAbsolutePath];
  for (const absolute of input.entryDirectImports) {
    const key = normalizeSlashes(absolute);
    if (seen.has(key) || scanExtension(absolute) === null) {
      continue;
    }
    seen.add(key);
    files.push(absolute);
  }
  return files;
}

interface ScanFileContent {
  content: string;
  extension: string;
  path: string;
}

async function readScanFiles(paths: string[]): Promise<ScanFileContent[]> {
  const reads = await Promise.all(
    paths.map(async (path): Promise<ScanFileContent | null> => {
      // scanExtension filtered node_modules already; entry may still be any ext.
      const extension = scanExtension(path) ?? "tsx";
      try {
        return { content: await readFile(path, "utf8"), extension, path };
      } catch {
        // Deleted between rebuild and scan — the next stale event recompiles.
        return null;
      }
    })
  );
  return reads.filter((file): file is ScanFileContent => file !== null);
}

function hashFileSet(files: ScanFileContent[]): string {
  const hash = createHash("sha256");
  // Paths are unique within a scan set; simple lexicographic order is stable.
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

const TAILWIND_PROPERTY_RULE_RE = /@property\s+[^{}]*\{[^{}]*\}/gu;

/**
 * Split top-level `@property --tw-*` registrations out of the built CSS.
 * `@property` is only valid at the top level of a stylesheet — inside the
 * `@scope` wrapper Chromium drops it and shadow/gradient/transform utilities
 * silently break. Everything else (selectors, @media, @supports) stays in the
 * scoped part; the unscoped tail carries no selector rules by construction.
 */
export function splitTailwindPropertyRules(built: string): {
  css: string;
  propertyCss: string;
} {
  const properties: string[] = [];
  const rest = built
    .replace(TAILWIND_PROPERTY_RULE_RE, (match) => {
      properties.push(match.trim());
      return "";
    })
    .trim();
  return {
    // A rule-less residue (header comment only) is not worth injecting.
    css: rest.includes("{") ? rest : "",
    propertyCss: properties.join("\n"),
  };
}

/**
 * Direct imports of the entry from the esbuild metafile — the degraded scan
 * set ("entry + one dependency level"). Virtual/namespace inputs and external
 * runtime URLs are skipped.
 */
export function entryDirectImportsFromMetafile(
  metafile: Metafile | undefined,
  fenceRoot: string,
  entryAbsolutePath: string
): string[] {
  if (!metafile) {
    return [];
  }
  const entryRel = normalizeSlashes(relative(fenceRoot, entryAbsolutePath));
  for (const [key, record] of Object.entries(metafile.inputs)) {
    const normalizedKey = normalizeSlashes(key);
    if (normalizedKey !== entryRel && !normalizedKey.endsWith(`/${entryRel}`)) {
      continue;
    }
    const out: string[] = [];
    for (const imported of record.imports) {
      if (imported.external) {
        continue;
      }
      const path = normalizeSlashes(imported.path);
      // Namespaced virtual modules ("pier-canvas-stub:…") have no file body.
      if (path.includes(":") && !/^[A-Za-z]:\//u.test(path)) {
        continue;
      }
      out.push(isAbsolute(path) ? path : join(fenceRoot, path));
    }
    return out;
  }
  return [];
}

function degradedScanDiagnostic(budgetMs: number): LiveModuleDiagnostic {
  return {
    message: `Tailwind utilities were scanned from the canvas entry and its direct imports only (a previous scan exceeded the ${budgetMs}ms budget); classes used deeper in the import graph may be missing`,
    severity: "warning",
  };
}

function degradeTransitionDiagnostic(
  durationMs: number,
  budgetMs: number
): LiveModuleDiagnostic {
  return {
    message: `Tailwind scan took ${Math.round(durationMs)}ms (budget ${budgetMs}ms); subsequent reloads scan only the canvas entry and its direct imports`,
    severity: "warning",
  };
}

function failureDiagnostic(error: unknown): LiveModuleDiagnostic {
  return {
    message: `canvas Tailwind generation failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
    severity: "warning",
  };
}

/**
 * Scan the module's source file set and build utility CSS. Never throws and
 * never fails the compile: on internal errors the canvas still renders with
 * its explicit CSS, and the problem surfaces as a warning diagnostic.
 */
export async function buildCanvasTailwindCss(
  input: CanvasTailwindInput
): Promise<CanvasTailwindOutput> {
  const budgetMs = input.hotBudgetMs ?? CANVAS_TAILWIND_HOT_BUDGET_MS;
  const slot = input.cacheSlot;
  const diagnostics: LiveModuleDiagnostic[] = [];

  const fullScan = collectScanFiles(input);
  const degradedScan = collectDegradedScanFiles(input);
  const canDegrade = degradedScan.length < fullScan.length;
  const useDegraded = slot.degradeScan === true && canDegrade;

  const readStarted = performance.now();
  const files = await readScanFiles(useDegraded ? degradedScan : fullScan);
  const fileSetHash = hashFileSet(files);
  const readMs = performance.now() - readStarted;

  if (
    slot.css !== undefined &&
    slot.propertyCss !== undefined &&
    slot.fileSetHash === fileSetHash
  ) {
    if (slot.cssDegraded) {
      diagnostics.push(degradedScanDiagnostic(budgetMs));
    }
    return {
      css: slot.css,
      diagnostics,
      durationMs: readMs,
      fromCache: true,
      propertyCss: slot.propertyCss,
      usedDegradedScan: slot.cssDegraded === true,
    };
  }

  let compiler: TailwindCompiler;
  try {
    // Compiler creation is one-time per context — excluded from the budget.
    compiler = await getCompiler(slot, dirname(input.entryAbsolutePath));
  } catch (error) {
    slot.compilerPromise = undefined;
    diagnostics.push(failureDiagnostic(error));
    return {
      css: "",
      diagnostics,
      durationMs: readMs,
      fromCache: false,
      propertyCss: "",
      usedDegradedScan: useDegraded,
    };
  }

  try {
    const buildStarted = performance.now();
    const oxide = await loadOxide();
    const scanner = new oxide.Scanner({ sources: [] });
    const candidates = scanner.scanFiles(
      files.map((file) => ({
        content: file.content,
        extension: file.extension,
      }))
    );
    // compiler.build accumulates candidates across calls; removed classes may
    // linger as unused rules until the context recycles — harmless in the DOM.
    const built = compiler.build(candidates);
    const { css, propertyCss } = splitTailwindPropertyRules(built);
    const durationMs = readMs + (performance.now() - buildStarted);

    slot.css = css;
    slot.cssDegraded = useDegraded;
    slot.fileSetHash = fileSetHash;
    slot.propertyCss = propertyCss;

    if (useDegraded) {
      diagnostics.push(degradedScanDiagnostic(budgetMs));
    } else if (durationMs > budgetMs && canDegrade) {
      slot.degradeScan = true;
      diagnostics.push(degradeTransitionDiagnostic(durationMs, budgetMs));
    }

    return {
      css,
      diagnostics,
      durationMs,
      fromCache: false,
      propertyCss,
      usedDegradedScan: useDegraded,
    };
  } catch (error) {
    diagnostics.push(failureDiagnostic(error));
    return {
      css: "",
      diagnostics,
      durationMs: readMs,
      fromCache: false,
      propertyCss: "",
      usedDegradedScan: useDegraded,
    };
  }
}
