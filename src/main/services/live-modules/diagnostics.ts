import type { LiveModuleDiagnostic } from "@shared/contracts/live-modules.ts";
import type { Message, PartialMessage } from "esbuild";
import { LiveModuleFenceError } from "./fence.ts";
import { toProjectRelative } from "./resolve.ts";

export function diagnosticFromError(
  error: unknown,
  file?: string
): LiveModuleDiagnostic {
  if (error instanceof LiveModuleFenceError) {
    return {
      file,
      message: error.diagnosticMessage,
      severity: "error",
    };
  }
  return {
    file,
    message: error instanceof Error ? error.message : String(error),
    severity: "error",
  };
}

/** esbuild Message / PartialMessage → LiveModuleDiagnostic (1-based line/col). */
export function diagnosticFromEsbuildMessage(
  msg: Message | PartialMessage,
  severity: "error" | "warning"
): LiveModuleDiagnostic {
  const loc = msg.location;
  return {
    column: loc?.column == null ? undefined : loc.column + 1,
    file: loc?.file || undefined,
    line: loc?.line || undefined,
    message: msg.text?.trim() ? msg.text : "unknown esbuild error",
    severity,
  };
}

/**
 * Flatten an esbuild BuildFailure (or any throw) into structured diagnostics.
 * Prefer `errors[]` / `warnings[]` location fields over the aggregated message.
 */
export function diagnosticsFromBuildFailure(
  error: unknown
): LiveModuleDiagnostic[] {
  if (error && typeof error === "object" && "errors" in error) {
    const fail = error as {
      errors?: Array<Message | PartialMessage>;
      warnings?: Array<Message | PartialMessage>;
    };
    const out: LiveModuleDiagnostic[] = [];
    for (const entry of fail.errors ?? []) {
      out.push(diagnosticFromEsbuildMessage(entry, "error"));
    }
    for (const entry of fail.warnings ?? []) {
      out.push(diagnosticFromEsbuildMessage(entry, "warning"));
    }
    if (out.length > 0) {
      return out;
    }
  }
  return [diagnosticFromError(error)];
}

/** Failure payload that always includes the entry in `graph` for watch recovery. */
export function compileFailureResult(
  diagnostics: LiveModuleDiagnostic[],
  graph: Set<string>,
  entryAbsolutePath: string,
  projectRoot: string | null,
  contentRoot: string
): {
  diagnostics: LiveModuleDiagnostic[];
  graph: string[];
  ok: false;
} {
  const root = projectRoot ?? contentRoot;
  const next = new Set(graph);
  next.add(toProjectRelative(entryAbsolutePath, root));
  return {
    diagnostics,
    graph: [...next].sort(),
    ok: false,
  };
}
