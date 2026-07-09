import type { AccountIdentity } from "./identity.ts";
import type { CodexAccountRecord } from "./state.ts";

/**
 * 从登录身份构造新的 codex 账号记录。doAdoptCurrent / doAdd 共用,
 * 保证两处 record 形状一致(createdAt / updatedAt / provider / 可选 planType /
 * providerAccountId;doAdd 额外带 lastAuthenticatedAt)。
 */
export function buildAccountRecord(
  identity: AccountIdentity,
  id: string,
  now: number,
  lastAuthenticatedAt?: number
): CodexAccountRecord {
  return {
    createdAt: now,
    email: identity.email,
    id,
    provider: "codex",
    updatedAt: now,
    ...(lastAuthenticatedAt ? { lastAuthenticatedAt } : {}),
    ...(identity.planType ? { planType: identity.planType } : {}),
    ...(identity.providerAccountId
      ? { providerAccountId: identity.providerAccountId }
      : {}),
  };
}

/**
 * 把登录身份合并进已有账号记录。doAdoptCurrent / doAdd 的 existing 分支共用,
 * 保证更新字段一致(email / updatedAt / 可选 planType / providerAccountId;
 * doAdd 额外刷新 lastAuthenticatedAt)。
 */
export function mergeIdentityIntoAccount(
  account: CodexAccountRecord,
  identity: AccountIdentity,
  now: number,
  lastAuthenticatedAt?: number
): CodexAccountRecord {
  return {
    ...account,
    email: identity.email,
    updatedAt: now,
    ...(lastAuthenticatedAt ? { lastAuthenticatedAt } : {}),
    ...(identity.planType ? { planType: identity.planType } : {}),
    ...(identity.providerAccountId
      ? { providerAccountId: identity.providerAccountId }
      : {}),
  };
}
