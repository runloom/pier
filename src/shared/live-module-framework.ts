/**
 * Live Module framework (renderer) detection.
 *
 * React is the core host path (`pier/canvas` = React/@pier/ui).
 * Vue / Solid / Svelte canvases compile against the **project's** framework
 * packages (bundled into the module) and mount with that framework's API.
 * One canvas file = one framework — do not mix in one module tree.
 */

export const LIVE_MODULE_FRAMEWORKS = [
  "react",
  "vue",
  "solid",
  "svelte",
] as const;

export type LiveModuleFramework = (typeof LIVE_MODULE_FRAMEWORKS)[number];

/** Ordered: more specific suffixes first (solid before generic tsx). */
const FRAMEWORK_SUFFIXES: ReadonlyArray<{
  framework: LiveModuleFramework;
  suffix: string;
}> = [
  { framework: "solid", suffix: ".canvas.solid.tsx" },
  { framework: "solid", suffix: ".canvas.solid.jsx" },
  { framework: "react", suffix: ".canvas.tsx" },
  { framework: "react", suffix: ".canvas.jsx" },
  { framework: "vue", suffix: ".canvas.vue" },
  { framework: "svelte", suffix: ".canvas.svelte" },
];

/**
 * Leading-dot canvas file suffixes (e.g. `.canvas.tsx`). Single source for
 * framework detection; keep `packages/ui` `PIER_CANVAS_FILE_EXTENSIONS` in
 * sync via unit test (ui package cannot import host `shared/`).
 */
export const LIVE_MODULE_CANVAS_FILE_SUFFIXES: readonly string[] =
  FRAMEWORK_SUFFIXES.map(({ suffix }) => suffix);

export function isLiveModuleCanvasFileName(fileName: string): boolean {
  const base = fileName.split(/[/\\]/u).at(-1) ?? "";
  const lowered = base.toLowerCase();
  return FRAMEWORK_SUFFIXES.some(({ suffix }) => {
    if (lowered.length <= suffix.length) {
      return false;
    }
    return lowered.endsWith(suffix);
  });
}

export function detectLiveModuleFrameworkFromFileName(
  fileName: string
): LiveModuleFramework | null {
  const base = fileName.split(/[/\\]/u).at(-1) ?? "";
  const lowered = base.toLowerCase();
  for (const { framework, suffix } of FRAMEWORK_SUFFIXES) {
    if (lowered.length > suffix.length && lowered.endsWith(suffix)) {
      return framework;
    }
  }
  return null;
}

/** Bare package prefixes resolved from the project for non-React frameworks. */
export function frameworkPackageAllowlist(
  framework: LiveModuleFramework
): readonly string[] {
  switch (framework) {
    case "react":
      return [];
    case "vue":
      return ["vue", "@vue/"];
    case "solid":
      return ["solid-js", "solid-js/"];
    case "svelte":
      return ["svelte", "svelte/"];
    default: {
      const _exhaustive: never = framework;
      return _exhaustive;
    }
  }
}

export function isFrameworkBarePackage(
  specifier: string,
  framework: LiveModuleFramework
): boolean {
  for (const prefix of frameworkPackageAllowlist(framework)) {
    if (prefix.endsWith("/")) {
      if (specifier === prefix.slice(0, -1) || specifier.startsWith(prefix)) {
        return true;
      }
    } else if (specifier === prefix || specifier.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}
