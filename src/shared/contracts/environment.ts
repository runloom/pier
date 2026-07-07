import { z } from "zod";
import { terminalLaunchEnvKeySchema } from "./terminal-launch.ts";

const copyPatternSchema = z.array(z.string().min(1).max(256)).max(64);

export const localEnvironmentProjectSchema = z
  .object({
    cleanupCommand: z.string().max(12_000).default(""),
    copyPatterns: copyPatternSchema.default([]),
    env: z.record(terminalLaunchEnvKeySchema, z.string()).default({}),
    projectRootPath: z.string().min(1),
    setupCommand: z.string().max(12_000).default(""),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const localEnvironmentWorktreeBindingSchema = z
  .object({
    createdAt: z.number().int().nonnegative(),
    projectRootPath: z.string().min(1),
    worktreePath: z.string().min(1),
  })
  .strict();

export const localEnvironmentStateSchema = z
  .object({
    projects: z.array(localEnvironmentProjectSchema).default([]),
    version: z.literal(1).default(1),
    worktreeBindings: z
      .array(localEnvironmentWorktreeBindingSchema)
      .default([]),
  })
  .strict();

/**
 * 每项目的 `.pier/environment.json` 文件格式.
 * 全局注册表 (`local-environments.json`) 里 `projects[]` 只存 `{ projectRootPath }` 一行,
 * 具体 setup/cleanup/env/copyPatterns 都从这个 per-project 文件读, 是否生效以文件存在与否为准.
 */
export const localEnvironmentProjectFileSchema = z
  .object({
    cleanupCommand: z.string().max(12_000).default(""),
    copyPatterns: copyPatternSchema.default([]),
    env: z.record(terminalLaunchEnvKeySchema, z.string()).default({}),
    setupCommand: z.string().max(12_000).default(""),
    updatedAt: z.number().int().nonnegative(),
    version: z.literal(1).default(1),
  })
  .strict();

export const environmentSnapshotRequestSchema = z
  .object({ projectRootPath: z.string().min(1).optional() })
  .strict();

export const environmentProjectRequestSchema = z
  .object({ projectRootPath: z.string().min(1) })
  .strict();

export const environmentUpdateRequestSchema = z
  .object({
    cleanupCommand: z.string().max(12_000),
    copyPatterns: copyPatternSchema,
    env: z.record(terminalLaunchEnvKeySchema, z.string()),
    projectRootPath: z.string().min(1),
    setupCommand: z.string().max(12_000),
  })
  .strict();

export const environmentWorktreeBindingRequestSchema = z
  .object({ worktreePath: z.string().min(1) })
  .strict();

export const localEnvironmentWorktreeBindingSnapshotSchema = z
  .object({
    cleanupCommand: z.string().max(12_000),
    copyPatterns: copyPatternSchema,
    env: z.record(terminalLaunchEnvKeySchema, z.string()),
    hasCleanupScript: z.boolean(),
    projectRootPath: z.string().min(1),
    setupCommand: z.string().max(12_000),
    worktreePath: z.string().min(1),
  })
  .strict();

export type LocalEnvironmentProject = z.infer<
  typeof localEnvironmentProjectSchema
>;
export type LocalEnvironmentWorktreeBinding = z.infer<
  typeof localEnvironmentWorktreeBindingSchema
>;
export type LocalEnvironmentState = z.infer<typeof localEnvironmentStateSchema>;
export type EnvironmentSnapshotRequest = z.infer<
  typeof environmentSnapshotRequestSchema
>;
export type EnvironmentProjectRequest = z.infer<
  typeof environmentProjectRequestSchema
>;
export type EnvironmentUpdateRequest = z.infer<
  typeof environmentUpdateRequestSchema
>;
export type EnvironmentWorktreeBindingRequest = z.infer<
  typeof environmentWorktreeBindingRequestSchema
>;
export type LocalEnvironmentWorktreeBindingSnapshot = z.infer<
  typeof localEnvironmentWorktreeBindingSnapshotSchema
>;

export type LocalEnvironmentProjectFile = z.infer<
  typeof localEnvironmentProjectFileSchema
>;
