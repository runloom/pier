import { z } from "zod";

/** Max length of an `instance.json` command string (shell text, not interpolated). */
export const CANVAS_INSTANCE_COMMAND_MAX_LENGTH = 8192;

export const CANVAS_COMMAND_GRANT_STORE_VERSION = 1;

export const canvasInstanceCommandCwdSchema = z.enum([
  "canvasDir",
  "projectRoot",
]);
export type CanvasInstanceCommandCwd = z.infer<
  typeof canvasInstanceCommandCwdSchema
>;

export const canvasInstanceCommandSchema = z
  .object({
    command: z.string().min(1).max(CANVAS_INSTANCE_COMMAND_MAX_LENGTH),
    cwd: canvasInstanceCommandCwdSchema.optional(),
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9._-]*$/u),
  })
  .strict();
export type CanvasInstanceCommand = z.infer<typeof canvasInstanceCommandSchema>;

/** `instance.json` may carry methodology fields; only `commands` is loaded here. */
export const canvasInstanceCommandsFileSchema = z
  .object({
    commands: z.array(canvasInstanceCommandSchema).max(64),
  })
  .passthrough();

export const canvasCommandInvokeRequestSchema = z.object({
  payload: z.object({
    canvasPath: z.string().min(1),
    key: z.string().min(1),
    projectRootPath: z.string().min(1),
  }),
  type: z.literal("canvasCommand.invoke"),
});

export const canvasCommandInvokeResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("started"),
    runId: z.string().min(1),
  }),
  z.object({ kind: z.literal("cancelled") }),
]);
export type CanvasCommandInvokeResult = z.infer<
  typeof canvasCommandInvokeResultSchema
>;

export const canvasCommandGrantEntrySchema = z
  .object({
    commandHash: z.string().min(1),
    grantedAt: z.string().min(1),
  })
  .strict();

/** Shape of `{userData}/canvas-command-grants.json`. Never stored in the project. */
export const canvasCommandGrantStoreSchema = z
  .object({
    grants: z.record(z.string().min(1), canvasCommandGrantEntrySchema),
    version: z.literal(CANVAS_COMMAND_GRANT_STORE_VERSION),
  })
  .strict();
export type CanvasCommandGrantStore = z.infer<
  typeof canvasCommandGrantStoreSchema
>;

export function emptyCanvasCommandGrantStore(): CanvasCommandGrantStore {
  return { grants: {}, version: CANVAS_COMMAND_GRANT_STORE_VERSION };
}

export type ParseCanvasInstanceCommandsResult =
  | { commands: ReadonlyMap<string, CanvasInstanceCommand>; ok: true }
  | { message: string; ok: false };

/**
 * Parse `instance.json` `commands`. Duplicate keys and invalid entries fail.
 * A missing `commands` field is an empty list (the canvas declared none).
 */
export function parseCanvasInstanceCommands(
  value: unknown
): ParseCanvasInstanceCommandsResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { message: "instance.json must be an object", ok: false };
  }
  if (!("commands" in value)) {
    return { commands: new Map(), ok: true };
  }
  const parsed = canvasInstanceCommandsFileSchema.safeParse(value);
  if (!parsed.success) {
    return { message: "instance.json commands are invalid", ok: false };
  }
  const commands = new Map<string, CanvasInstanceCommand>();
  for (const entry of parsed.data.commands) {
    if (commands.has(entry.key)) {
      return {
        message: `instance.json declares ${entry.key} more than once`,
        ok: false,
      };
    }
    commands.set(entry.key, entry);
  }
  return { commands, ok: true };
}

/** Canonical grant identity: cwd defaults to projectRoot. */
export function canvasCommandCanonical(input: {
  command: string;
  cwd?: CanvasInstanceCommandCwd;
}): string {
  return JSON.stringify({
    command: input.command,
    cwd: input.cwd ?? "projectRoot",
  });
}
