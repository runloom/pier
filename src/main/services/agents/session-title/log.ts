/**
 * 标题链路的唯一日志出口。终态覆盖全部分支——真机上「标题不对」时，
 * 一条日志就能定位是哪一层没走通。
 *
 * `PIER_LOG_LEVEL=debug pnpm dev` 打开。
 */

import { createLogger } from "@shared/logger.ts";

export type TitleOutcome =
  /** 写入成功 */
  | "applied"
  /** 秩不升高（已有更高层标题，含用户改名） */
  | "rejected-rank"
  /** 输入是噪声（寒暄 / slash / 报错栈 / 纯路径） */
  | "noise"
  /** hook 没带出 prompt 文案 */
  | "empty"
  /** 模型层超时 */
  | "timeout"
  /** 该 agent 无 titleArgs，或依赖未注册 */
  | "unavailable"
  /** 模型层结果与规则层相同，不值得写 */
  | "same-as-rule"
  /** 用户在设置里关掉了模型精修 */
  | "disabled"
  /** 并发闸拦截（同 panel 在途，或全局并发已满） */
  | "concurrency-skipped"
  /** 该面板精修预算已耗尽（失败次数达上限），永久放弃 */
  | "exhausted";

const log = createLogger("agent.title");

export function logTitleTier(ctx: {
  panelId: string;
  tier: "rule" | "model";
  outcome: TitleOutcome;
  agentId?: string;
  attempt?: number;
  durationMs?: number;
}): void {
  log.debug("tier", ctx);
}
