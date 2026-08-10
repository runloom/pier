/**
 * 宿主侧 AgentCaller 凭证签发绑定。
 * local-control 注册成功后 bind；终端 agent 启动路径取 env 注入。
 * 未 bind（控制面未就绪 / 测试未注入）时返回 null，不阻断终端创建。
 */
import type {
  IssueAgentCallerCredentialArgs,
  IssuedAgentCallerCredential,
} from "./issue-credential.ts";

export type AgentCallerIssuer = (
  args?: Omit<IssueAgentCallerCredentialArgs, "store" | "bootId">
) => IssuedAgentCallerCredential;

const PARENT_CREDENTIAL_ENV_KEYS = [
  "PIER_AGENT_CALLER_CREDENTIAL_FILE",
] as const;

let issuer: AgentCallerIssuer | null = null;

export function bindAgentCallerIssuer(next: AgentCallerIssuer | null): void {
  issuer = next;
}

export function getBoundAgentCallerIssuer(): AgentCallerIssuer | null {
  return issuer;
}

/**
 * 从 env 表中剥离父进程 / 宿主残留的 agent 调用凭证路径，
 * 避免子 agent 误用父协调者凭证。
 */
export function scrubAgentCallerCredentialEnv(
  env: Record<string, string>
): Record<string, string> {
  let changed = false;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if ((PARENT_CREDENTIAL_ENV_KEYS as readonly string[]).includes(key)) {
      changed = true;
      continue;
    }
    out[key] = value;
  }
  return changed ? out : env;
}

/**
 * 签发当前 boot 下的 agent 调用凭证 env；失败或未 bind 返回 null。
 * 调用方应 best-effort：缺凭证不阻断 spawn。
 */
export function tryIssueAgentCallerLaunchEnv(
  args: Omit<IssueAgentCallerCredentialArgs, "store" | "bootId"> = {}
): IssuedAgentCallerCredential["env"] | null {
  if (!issuer) {
    return null;
  }
  try {
    return issuer(args).env;
  } catch (error) {
    console.warn("[agent-caller] issue credential for launch failed:", error);
    return null;
  }
}
