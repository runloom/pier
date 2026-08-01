import type {
  PierFileTreeAutoRevealMode,
  PierFileTreeRevealIntent,
  PierFileTreeRevealOptions,
  PierFileTreeRevealScroll,
} from "./tree-types.ts";

/**
 * Inputs for the single reveal-policy owner (VS Code-like intent split).
 * Pure: no DOM / React / tree model.
 */
export interface ResolveRevealPolicyInput {
  /**
   * Active-file tracking mode. Only applies when `intent === "active-file"`.
   * Default `"on"`.
   */
  autoReveal?: PierFileTreeAutoRevealMode;
  intent: PierFileTreeRevealIntent;
  /**
   * Caller-supplied option overrides (scroll / expandTarget). Explicit callers
   * may still hard-set values; defaults always come from this resolver first.
   */
  overrides?: Pick<PierFileTreeRevealOptions, "expandTarget" | "scroll">;
  /**
   * True when the path matches auto-reveal exclude globs (e.g. node_modules).
   * Only applies to `active-file`.
   */
  pathExcluded?: boolean;
}

/**
 * Resolved flags consumed by `revealFileTreePath` / the reveal controller.
 */
export interface ResolvedRevealPolicy {
  /** Expand a directory target after ancestors (explicit/search default true). */
  expandTarget: boolean;
  /**
   * Scroll alignment. `"none"` skips `scrollToPath` (select-only / inspect).
   */
  scroll: PierFileTreeRevealScroll;
  /**
   * When false, the controller must not select/scroll (active-file off/exclude).
   */
  shouldReveal: boolean;
  /**
   * Whether an API/explicit-style reveal should suppress active-file re-assert
   * until the active path changes.
   */
  suppressActive: boolean;
}

/**
 * Single source of default scroll/expand semantics for file-tree reveal.
 *
 * Intent matrix (gold standard):
 * - explicit / search → center, expandTarget true, suppress active
 * - active-file → nearest | none | skip (autoReveal on|select|off), expandTarget false
 * - root → top
 * - inspect → no full reveal pipeline
 */
export function resolveRevealPolicy(
  input: ResolveRevealPolicyInput
): ResolvedRevealPolicy {
  const autoReveal = input.autoReveal ?? "on";
  const pathExcluded = input.pathExcluded === true;
  const overrides = input.overrides;

  if (input.intent === "inspect") {
    return {
      expandTarget: false,
      scroll: "none",
      shouldReveal: false,
      suppressActive: false,
    };
  }

  if (input.intent === "active-file") {
    if (autoReveal === "off" || pathExcluded) {
      return {
        expandTarget: false,
        scroll: "none",
        shouldReveal: false,
        suppressActive: false,
      };
    }
    const scroll: PierFileTreeRevealScroll =
      autoReveal === "select" ? "none" : "nearest";
    return {
      expandTarget: overrides?.expandTarget ?? false,
      scroll: overrides?.scroll ?? scroll,
      shouldReveal: true,
      suppressActive: false,
    };
  }

  if (input.intent === "root") {
    return {
      expandTarget: overrides?.expandTarget ?? false,
      scroll: overrides?.scroll ?? "top",
      shouldReveal: true,
      suppressActive: true,
    };
  }

  // explicit | search — user-initiated: optimal reading zone (center).
  return {
    expandTarget: overrides?.expandTarget ?? true,
    scroll: overrides?.scroll ?? "center",
    shouldReveal: true,
    suppressActive: true,
  };
}

/**
 * Map empty path to root intent; otherwise keep caller intent or default
 * to explicit (API / breadcrumb).
 */
export function resolveRevealIntentForPath(
  path: string,
  intent: PierFileTreeRevealIntent | undefined
): PierFileTreeRevealIntent {
  if (path === "") {
    return "root";
  }
  return intent ?? "explicit";
}
