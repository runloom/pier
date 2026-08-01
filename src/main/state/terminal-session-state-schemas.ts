import { normalizeAgentSessionTitleSource } from "@shared/agent-session-title/index.ts";
import { agentSessionTitleValueSchema } from "@shared/agent-session-title/schema.ts";
import { agentKindSchema } from "@shared/contracts/agent.ts";
import { agentSessionTitleSourceSchema } from "@shared/contracts/foreground-activity.ts";
import {
  normalizePanelTabChromeInput,
  panelContextSchema,
  panelTabChromeSchema,
} from "@shared/contracts/panel.ts";
import { taskPanelMetadataSchema } from "@shared/contracts/tasks.ts";
import { terminalAgentRestoreLaunchOptionsSchema } from "@shared/contracts/terminal/launch.ts";
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

/**
 * 读取期清洗产品 sessionTitle：仅 provider / user。
 * 历史 prompt/auto/rule/model 或有标题无合法来源 → 字段整段丢弃（不回写盘，
 * 下次合法写入时自然覆盖）。
 */
function scrubLegacyAgentSessionTitle(raw: unknown): unknown {
  if (!(raw && typeof raw === "object" && !Array.isArray(raw))) {
    return raw;
  }
  const record = raw as Record<string, unknown>;
  const source = normalizeAgentSessionTitleSource(record.sessionTitleSource);
  if (source) {
    return { ...record, sessionTitleSource: source };
  }
  if (
    record.sessionTitle === undefined &&
    record.sessionTitleSource === undefined &&
    record.sessionTitleSessionId === undefined
  ) {
    return record;
  }
  const {
    sessionTitle: _t,
    sessionTitleSource: _s,
    sessionTitleSessionId: _id,
    ...rest
  } = record;
  return rest;
}

export const terminalPanelSessionSchema = z.preprocess(
  scrubLegacyAgentSessionTitle,
  z.object({
    agent: terminalAgentPanelMetadataSchema.optional(),
    context: panelContextSchema.optional(),
    tab: z.preprocess(
      normalizePanelTabChromeInput,
      panelTabChromeSchema.optional()
    ),
    task: taskPanelMetadataSchema.optional(),
    /** OSC / 终端装饰标题（≠ 产品 sessionTitle）。 */
    title: z.string().optional(),
    /** 产品会话名：仅 provider / user。 */
    sessionTitle: agentSessionTitleValueSchema.optional(),
    /** 标题所属的 provider 主会话；缺席表示尚未绑定。 */
    sessionTitleSessionId: z.string().min(1).max(128).optional(),
    /** 仅 provider | user；旧源读取期丢弃。 */
    sessionTitleSource: z.preprocess(
      normalizeAgentSessionTitleSource,
      agentSessionTitleSourceSchema.optional()
    ),
    updatedAt: z.string(),
  })
);

const terminalWindowSessionSchema = z.object({
  panels: z.record(z.string(), terminalPanelSessionSchema),
});

export const terminalSessionStateSchema = z.object({
  version: z.literal(1),
  windows: z.record(z.string(), terminalWindowSessionSchema),
});

export type TerminalPanelSession = z.infer<typeof terminalPanelSessionSchema>;
export type TerminalSessionState = z.infer<typeof terminalSessionStateSchema>;
