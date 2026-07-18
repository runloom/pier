import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface AccountIdentity {
  email: string;
  planType?: string;
  providerAccountId?: string;
  /** ChatGPT subscription period end from id_token auth claims (ms). */
  subscriptionExpiresAt?: number;
}

const OPENAI_AUTH_NS = "https://api.openai.com/auth";

/**
 * 从 codex id_token JWT（不校验签名——本地已存文件）解析身份声明。
 * 返回 null 表示 token 格式不可用或缺少 email。
 */
export function parseIdTokenClaims(idToken: string): AccountIdentity | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const payloadSegment = parts[1];
  if (!payloadSegment) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf-8")
    );
    const email = payload.email;
    if (typeof email !== "string" || email.length === 0) {
      return null;
    }
    const authNs =
      typeof payload[OPENAI_AUTH_NS] === "object" &&
      payload[OPENAI_AUTH_NS] !== null
        ? (payload[OPENAI_AUTH_NS] as Record<string, unknown>)
        : undefined;
    let subscriptionExpiresAt: number | undefined;
    if (typeof authNs?.chatgpt_subscription_active_until === "string") {
      const ms = Date.parse(authNs.chatgpt_subscription_active_until);
      if (Number.isFinite(ms)) {
        subscriptionExpiresAt = ms;
      }
    }
    return {
      email,
      ...(typeof authNs?.chatgpt_plan_type === "string"
        ? { planType: authNs.chatgpt_plan_type }
        : {}),
      ...(typeof authNs?.chatgpt_account_id === "string"
        ? { providerAccountId: authNs.chatgpt_account_id }
        : {}),
      ...(subscriptionExpiresAt === undefined ? {} : { subscriptionExpiresAt }),
    };
  } catch {
    return null;
  }
}

/**
 * 读取指定 CODEX_HOME 目录下的 auth.json，解析 id_token 身份。
 * 返回 null 表示文件不存在 / 损坏 / 缺少 id_token。
 */
export async function readCodexIdentity(
  homeDir: string
): Promise<AccountIdentity | null> {
  try {
    const raw = await readFile(join(homeDir, "auth.json"), "utf-8");
    const data = JSON.parse(raw);
    const idToken = data?.tokens?.id_token;
    if (typeof idToken !== "string" || idToken.length === 0) {
      return null;
    }
    return parseIdTokenClaims(idToken);
  } catch {
    return null;
  }
}
