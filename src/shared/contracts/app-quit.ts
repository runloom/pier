import { z } from "zod";

export const quitActivitySummarySchema = z
  .object({
    commandLine: z.string().min(1).max(4096).optional(),
    kind: z.enum(["agent", "shell", "task"]),
    label: z.string().min(1),
    panelId: z.string().min(1),
    windowId: z.string().min(1),
  })
  .strict();

export type QuitActivitySummary = z.infer<typeof quitActivitySummarySchema>;

export const appQuitConfirmationRequestSchema = z
  .object({
    quitId: z.string().min(1),
    summaries: z.array(quitActivitySummarySchema),
  })
  .strict();

export interface AppQuitConfirmationRequest {
  readonly quitId: string;
  readonly summaries: readonly QuitActivitySummary[];
}

export const appQuitDecisionPayloadSchema = z
  .object({
    decision: z.enum(["quit", "cancel"]),
    quitId: z.string().min(1),
  })
  .strict();

export type AppQuitDecisionPayload = z.infer<
  typeof appQuitDecisionPayloadSchema
>;
