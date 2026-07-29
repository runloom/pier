import { z } from "zod";

/**
 * LanguageTools contract — Agent-facing read-only LSP queries.
 * Reuses the same Policy + Provider + SessionHost pipeline as the editor;
 * Agent never spawns language servers directly.
 */

export const lspLocationSchema = z
  .object({
    range: z.object({
      end: z.object({
        character: z.number().int().nonnegative(),
        line: z.number().int().nonnegative(),
      }),
      start: z.object({
        character: z.number().int().nonnegative(),
        line: z.number().int().nonnegative(),
      }),
    }),
    uri: z.string().min(1),
  })
  .strict();

export type LspLocation = z.infer<typeof lspLocationSchema>;

export const lspDiagnosticSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    message: z.string(),
    range: z.object({
      end: z.object({
        character: z.number().int().nonnegative(),
        line: z.number().int().nonnegative(),
      }),
      start: z.object({
        character: z.number().int().nonnegative(),
        line: z.number().int().nonnegative(),
      }),
    }),
    severity: z.enum(["error", "warning", "information", "hint"]).optional(),
    source: z.string().optional(),
  })
  .strict();

export type LspDiagnostic = z.infer<typeof lspDiagnosticSchema>;

export const lspSymbolInformationSchema = z
  .object({
    containerName: z.string().optional(),
    kind: z.number().int().nonnegative(),
    location: lspLocationSchema,
    name: z.string().min(1),
  })
  .strict();

export type LspSymbolInformation = z.infer<typeof lspSymbolInformationSchema>;

export const lspReadOnlyMethodSchema = z.enum([
  "textDocument/declaration",
  "textDocument/definition",
  "textDocument/diagnostic",
  "textDocument/documentHighlight",
  "textDocument/documentSymbol",
  "textDocument/hover",
  "textDocument/implementation",
  "textDocument/references",
  "textDocument/typeDefinition",
  "workspace/diagnostic",
  "workspace/symbol",
]);
export type LspReadOnlyMethod = z.infer<typeof lspReadOnlyMethodSchema>;

/** IPC: main ← renderer/agent request for a single LSP JSON-RPC round-trip. */
export const lspRequestCommandSchema = z.object({
  /** LSP method, e.g. textDocument/definition */
  method: lspReadOnlyMethodSchema,
  /** LSP params object (opaque to host) */
  params: z.record(z.string(), z.unknown()),
  /** File path for provider match + session ensure */
  filePath: z.string().min(1),
  rootPath: z.string().min(1),
  isWorktree: z.boolean().optional(),
  workspaceKey: z.string().min(1).optional(),
});
export type LspRequestCommand = z.infer<typeof lspRequestCommandSchema>;

export const lspRequestResultSchema = z.object({
  ok: z.boolean(),
  /** LSP result (Location[], Diagnostic[], SymbolInformation[], or null) */
  result: z.unknown().nullable(),
  /** Deny reason when ok=false and no LSP result */
  reason: z.string().optional(),
});
export type LspRequestResult = z.infer<typeof lspRequestResultSchema>;
