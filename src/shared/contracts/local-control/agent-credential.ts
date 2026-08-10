/**
 * Agent caller binding 材料（本机纪律句柄，非安全登录）。
 *
 * 业界默认：宿主 spawn 注入不透明 bindingId；同 UID socket + peer/fs-acl 负责接入。
 * secret 仅可选增强（委派收紧 / 防粗伪造），默认签发不写 secret、不写凭证文件。
 * self 响应永不回传 secret。
 */
import { z } from "zod";

const nonEmpty = z.string().min(1);

export const agentCallerCredentialMaterialSchema = z.object({
  /** 不透明 binding id（wire/env 称 bindingId；历史字段名 credentialId） */
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
  /**
   * 可选持有证明。默认 binding 路径不签发；
   * 仅 method: agent-credential 时校验。
   */
  secret: nonEmpty.optional(),
});

export type AgentCallerCredentialMaterial = z.infer<
  typeof agentCallerCredentialMaterialSchema
>;

/** agents.self 非秘密视图 */
export const agentSelfSnapshotSchema = z.object({
  principalRef: nonEmpty,
  /** 与 material.credentialId 相同；产品文案用 binding */
  bindingId: nonEmpty,
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
    bindingId: material.credentialId,
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

/** 宿主注入 env 键：不透明 binding id（对齐 surface id 注入，非 secret 文件） */
export const PIER_AGENT_CALLER_BINDING_ENV = "PIER_AGENT_CALLER_BINDING";

/**
 * 旧凭证文件路径 env（兼容读取；默认签发不再写入）。
 * 仍 scrub，避免父进程路径泄漏到子 agent。
 */
export const PIER_AGENT_CALLER_CREDENTIAL_FILE_ENV =
  "PIER_AGENT_CALLER_CREDENTIAL_FILE";
