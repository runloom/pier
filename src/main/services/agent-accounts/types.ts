import type { AgentAccountProviderId } from "@shared/contracts/agent-accounts.ts";
import type { AccountIdentity } from "./identity.ts";

/** provider 内部接口。v1 只有 codex；v2 扩 claude 等时实现此接口即可。 */
export interface AgentAccountProvider {
  /** 获取活跃账号的用量（经 codex app-server JSON-RPC）。 */
  fetchUsage(signal: AbortSignal): Promise<AccountUsageResult>;
  readonly id: AgentAccountProviderId;
  /** spawn `codex login` 到指定托管目录。 */
  login(homeDir: string, signal: AbortSignal): Promise<void>;
  /** 托管 auth.json → ~/.codex/auth.json（write-file-atomic）。 */
  materialize(accountHomeDir: string): Promise<void>;
  /** 读取指定目录的 auth.json 身份。 */
  readIdentity(homeDir: string): Promise<AccountIdentity | null>;
  /**
   * ~/.codex/auth.json → 托管目录。回采前先读真实 auth 身份并与
   * expectedProviderAccountId 比对：不匹配说明外部已换号（漂移侦测的
   * debounce 还没来得及触发），跳过复制并返回 "identity-mismatch"，
   * 由 service 立即走漂移处理 —— 否则会把 B 账号的凭据写进 A 的托管目录。
   */
  syncBack(
    accountHomeDir: string,
    expectedProviderAccountId: string | undefined
  ): Promise<"identity-mismatch" | "ok">;
  /**
   * 外部漂移侦测。watch 的是 ~/.codex 目录（按文件名过滤 auth.json），
   * 不是文件本身：codex CLI 与本服务都用原子写（写临时文件 + rename），
   * macOS 上对单文件的 fs.watch 按 inode 追踪，rename 后会静默失效。
   */
  watchExternalAuth(cb: () => void): () => void;
}

export interface AccountUsageResult {
  error?: string;
  session?: { resetsAt?: number; usedPercent: number; windowMinutes?: number };
  status: "error" | "ok";
  weekly?: { resetsAt?: number; usedPercent: number; windowMinutes?: number };
}
