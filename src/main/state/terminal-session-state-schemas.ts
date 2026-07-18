import { agentKindSchema } from "@shared/contracts/agent.ts";
import {
  normalizePanelTabChromeInput,
  panelContextSchema,
  panelTabChromeSchema,
} from "@shared/contracts/panel.ts";
import { taskPanelMetadataSchema } from "@shared/contracts/tasks.ts";
import { terminalAgentRestoreLaunchOptionsSchema } from "@shared/contracts/terminal-launch.ts";
import { z } from "zod";

function stripLaunchEnv(value: unknown): unknown {
  if (!(value && typeof value === "object" && !Array.isArray(value))) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key]) => key !== "env"
    )
  );
}

export const terminalAgentPanelMetadataSchema = z.object({
  agentId: agentKindSchema,
  exitCode: z.number().int().optional(),
  finishedAt: z.number().int().nonnegative().optional(),
  launch: z.preprocess(stripLaunchEnv, terminalAgentRestoreLaunchOptionsSchema),
  resume: z
    .object({
      capturedAt: z.number().int().nonnegative(),
      sessionId: z.string().min(1).max(128),
      source: z.literal("hook"),
    })
    .optional(),
  restore: z
    .object({
      detachedAt: z.number().int().nonnegative().optional(),
    })
    .optional(),
  startedAt: z.number().int().nonnegative(),
  status: z.enum(["exited", "running"]),
});

export const terminalPanelSessionSchema = z.object({
  agent: terminalAgentPanelMetadataSchema.optional(),
  context: panelContextSchema.optional(),
  tab: z.preprocess(
    normalizePanelTabChromeInput,
    panelTabChromeSchema.optional()
  ),
  task: taskPanelMetadataSchema.optional(),
  title: z.string().optional(),
  updatedAt: z.string(),
});

const terminalWindowSessionSchema = z.object({
  panels: z.record(z.string(), terminalPanelSessionSchema),
});

export const terminalSessionStateSchema = z.object({
  version: z.literal(1),
  windows: z.record(z.string(), terminalWindowSessionSchema),
});

export type TerminalPanelSession = z.infer<typeof terminalPanelSessionSchema>;
export type TerminalSessionState = z.infer<typeof terminalSessionStateSchema>;
