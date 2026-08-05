import { z } from "zod";
import { type AgentKind, agentKindSchema } from "../agent.ts";

/** How Pier can help install/update this agent CLI. */
export const agentLifecycleSupportSchema = z.enum(["full", "guided", "none"]);
export type AgentLifecycleSupport = z.infer<typeof agentLifecycleSupportSchema>;

export const agentLifecycleActionSchema = z.enum(["install", "update"]);
export type AgentLifecycleAction = z.infer<typeof agentLifecycleActionSchema>;

/**
 * How “update available” is determined for a full agent.
 * - versioned: compare current vs latest (npm / brew)
 * - reinstall: no reliable latest; UI may offer reinstall-as-update
 * - none: update action not offered
 */
export const agentLifecycleUpdateModeSchema = z.enum([
  "versioned",
  "reinstall",
  "none",
]);
export type AgentLifecycleUpdateMode = z.infer<
  typeof agentLifecycleUpdateModeSchema
>;

export const agentInstallInfoSchema = z.object({
  isPathDefault: z.boolean(),
  path: z.string().min(1),
  runnable: z.boolean(),
  source: z.string().min(1),
  version: z.string().nullable(),
});
export type AgentInstallInfo = z.infer<typeof agentInstallInfoSchema>;

export const agentLifecycleGuideCommandSchema = z.object({
  command: z.string().min(1),
  label: z.string().min(1),
});
export type AgentLifecycleGuideCommand = z.infer<
  typeof agentLifecycleGuideCommandSchema
>;

export const agentLifecycleProbeSchema = z.object({
  agentId: agentKindSchema,
  /**
   * True when host can run an install plan for this agent (channels + platform).
   * UI should gate Install on this, not only support===full.
   */
  canInstall: z.boolean(),
  detected: z.boolean(),
  /** PES/env probe degraded — installs may be empty. */
  envDegraded: z.boolean().optional(),
  /**
   * Default shell one-liner for install (plan preview). Empty override uses this.
   */
  defaultInstallCommand: z.string().nullable().optional(),
  /**
   * Default shell one-liner for update (source-aware plan preview).
   */
  defaultUpdateCommand: z.string().nullable().optional(),
  guideCommands: z.array(agentLifecycleGuideCommandSchema).optional(),
  installedButBroken: z.boolean(),
  installs: z.array(agentInstallInfoSchema),
  isConflict: z.boolean(),
  latestVersion: z.string().nullable(),
  support: agentLifecycleSupportSchema,
  /** True when a newer version is known (versioned mode only). */
  updateAvailable: z.boolean(),
  updateMode: agentLifecycleUpdateModeSchema,
  /**
   * UI may show Update when versioned+available, reinstall+detected,
   * or versioned+detected with unknown latest (still can re-run update channels).
   */
  updateOffered: z.boolean(),
  version: z.string().nullable(),
});
export type AgentLifecycleProbe = z.infer<typeof agentLifecycleProbeSchema>;

export const agentLifecycleErrorCodeSchema = z.enum([
  "unsupported",
  "unavailable",
  "no_command",
  "command_failed",
  "version_unchanged",
  "not_runnable",
  "not_found_after_install",
  "already_installed",
  "busy",
  "cancelled",
  "timeout",
  "env_unavailable",
  "package_manager_missing",
]);
export type AgentLifecycleErrorCode = z.infer<
  typeof agentLifecycleErrorCodeSchema
>;

export const agentLifecycleSoftFailureSchema = z.enum([
  "version_unchanged",
  "not_runnable",
]);
export type AgentLifecycleSoftFailure = z.infer<
  typeof agentLifecycleSoftFailureSchema
>;

export const agentLifecycleActionResultSchema = z.object({
  action: agentLifecycleActionSchema,
  agentId: agentKindSchema,
  commandPreview: z.string().optional(),
  /** Machine-readable; renderer maps via i18n. */
  errorCode: agentLifecycleErrorCodeSchema.optional(),
  /** Optional technical detail (stderr tail) — not for primary title. */
  errorDetail: z.string().optional(),
  ok: z.boolean(),
  /** Correlates with cancel(runId). */
  runId: z.string().optional(),
  /** True when install was skipped because already present. */
  skipped: z.boolean().optional(),
  softFailure: agentLifecycleSoftFailureSchema.optional(),
  version: z.string().nullable().optional(),
});
export type AgentLifecycleActionResult = z.infer<
  typeof agentLifecycleActionResultSchema
>;

export const agentLifecycleRunRequestSchema = z.object({
  action: agentLifecycleActionSchema,
  agentId: agentKindSchema,
});
export type AgentLifecycleRunRequest = z.infer<
  typeof agentLifecycleRunRequestSchema
>;

export const agentLifecycleRunManyRequestSchema = z.object({
  action: agentLifecycleActionSchema,
  agentIds: z.array(agentKindSchema).min(1),
});
export type AgentLifecycleRunManyRequest = z.infer<
  typeof agentLifecycleRunManyRequestSchema
>;

export interface AgentLifecycleProbeRequest {
  agentIds?: readonly AgentKind[];
  /**
   * When true, also fetch latest versions. Default false for open-settings speed.
   */
  checkLatest?: boolean;
  /** When true, force multi-path enumeration. */
  deep?: boolean;
}

/** Live install/update progress (main → renderer broadcast). */
export const agentLifecycleProgressSchema = z.object({
  action: agentLifecycleActionSchema,
  agentId: agentKindSchema,
  /** Current step label (package manager name or "install script"). */
  label: z.string().min(1),
  /** 0–100 within the current tool step when known. */
  percent: z.number().min(0).max(100).optional(),
  runId: z.string().optional(),
  stepCount: z.number().int().positive(),
  stepIndex: z.number().int().nonnegative(),
});
export type AgentLifecycleProgress = z.infer<
  typeof agentLifecycleProgressSchema
>;
