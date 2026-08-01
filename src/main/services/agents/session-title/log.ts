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
  /** provider 没给出会话名，或规范化后为空 */
  | "empty";

const log = createLogger("agent.title");

export function logTitleTier(ctx: {
  panelId: string;
  tier: "provider";
  outcome: TitleOutcome;
  agentId?: string;
  /** provider 秩：标题所来自的原生记录（如 claude.transcript.ai_title）。 */
  nativeEvent?: string;
}): void {
  log.debug("tier", ctx);
}
