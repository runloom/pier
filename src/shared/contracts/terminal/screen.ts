/**
 * 终端 viewport 读屏有界契约（terminal.screen / terminal.read / agents.screen 共用）。
 * 不含 scrollback；滚回待 native / transcript。
 */
import { z } from "zod";

const nonEmpty = z.string().min(1);

export const TERMINAL_SCREEN_DEFAULT_MAX_LINES = 200;
export const TERMINAL_SCREEN_DEFAULT_MAX_BYTES = 65_536;
export const TERMINAL_SCREEN_HARD_MAX_BYTES = 1_048_576;
export const TERMINAL_SCREEN_MAX_LINES_LIMIT = 2000;

export const terminalScreenMaxLinesSchema = z
  .number()
  .int()
  .positive()
  .max(TERMINAL_SCREEN_MAX_LINES_LIMIT);

export const terminalScreenMaxBytesSchema = z
  .number()
  .int()
  .positive()
  .max(TERMINAL_SCREEN_HARD_MAX_BYTES);

export const terminalScreenPayloadSchema = z
  .object({
    capturedAt: z.number().int().nonnegative(),
    cols: z.number().int().nonnegative(),
    maxBytes: z.number().int().positive(),
    maxLines: z.number().int().positive(),
    panelId: nonEmpty,
    rows: z.number().int().nonnegative(),
    /** W1 仅当前 viewport；scrollback 不是本波次能力。 */
    scope: z.literal("viewport"),
    text: z.string(),
    truncated: z.boolean(),
    windowId: nonEmpty,
  })
  .strict()
  .refine(
    (value) =>
      !("scrollback" in value || "history" in value || "cursor" in value),
    { message: "screen must not carry scrollback/history/content cursor" }
  );

export type TerminalScreenPayload = z.infer<typeof terminalScreenPayloadSchema>;
