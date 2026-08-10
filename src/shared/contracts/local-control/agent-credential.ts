/**
 * Agent 调用凭证材料（T3 / W1）。
 * 文件中可含 secret 字段；self 响应不得回传 secret。
 */
import { z } from "zod";

const nonEmpty = z.string().min(1);

export const agentCallerCredentialMaterialSchema = z.object({
  credentialId: nonEmpty,
  bootId: nonEmpty,
  callerRuntimeId: nonEmpty,
  callerGeneration: z.number().int().nonnegative(),
  grantId: nonEmpty,
  parentClauseId: nonEmpty,
  childClauseId: z.string().min(1).optional(),
  allowedAgents: z.array(nonEmpty).min(1),
  operations: z.array(nonEmpty).min(1),
  maxDepth: z.number().int().nonnegative(),
  maxActiveChildren: z.number().int().nonnegative(),
  activeChildren: z.number().int().nonnegative().optional(),
  expiresAt: z.number().int().positive(),
  worktreeKey: nonEmpty.optional(),
  incarnationId: nonEmpty.optional(),
  /** 高熵 secret；仅存文件 / 内存，hello 时校验，永不进 self 响应 */
  secret: nonEmpty,
});

export type AgentCallerCredentialMaterial = z.infer<
  typeof agentCallerCredentialMaterialSchema
>;

/** agents.self 非秘密视图 */
export const agentSelfSnapshotSchema = z.object({
  principalRef: nonEmpty,
  credentialId: nonEmpty,
  bootId: nonEmpty,
  callerRuntimeId: nonEmpty,
  callerGeneration: z.number().int().nonnegative(),
  allowedAgents: z.array(nonEmpty),
  operations: z.array(nonEmpty),
  maxDepth: z.number().int().nonnegative(),
  maxActiveChildren: z.number().int().nonnegative(),
  activeChildren: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  worktreeKey: z.string().min(1).optional(),
  incarnationId: z.string().min(1).optional(),
});

export type AgentSelfSnapshot = z.infer<typeof agentSelfSnapshotSchema>;

export function toAgentSelfSnapshot(
  material: AgentCallerCredentialMaterial,
  principalRef: string
): AgentSelfSnapshot {
  return {
    principalRef,
    credentialId: material.credentialId,
    bootId: material.bootId,
    callerRuntimeId: material.callerRuntimeId,
    callerGeneration: material.callerGeneration,
    allowedAgents: [...material.allowedAgents],
    operations: [...material.operations],
    maxDepth: material.maxDepth,
    maxActiveChildren: material.maxActiveChildren,
    activeChildren: material.activeChildren ?? 0,
    expiresAt: material.expiresAt,
    ...(material.worktreeKey ? { worktreeKey: material.worktreeKey } : {}),
    ...(material.incarnationId
      ? { incarnationId: material.incarnationId }
      : {}),
  };
}
