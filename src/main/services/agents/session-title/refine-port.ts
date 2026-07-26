/**
 * 模型精修的外部依赖端口。app-core 在装配期注册；未注册则整层 no-op。
 *
 * 用端口而不是直接 import：`services/agents/` 不该 import git service 或
 * preferences store——与 foreground-activity ⊥ agents 同一条纪律。
 */

import type { AgentKind } from "@shared/contracts/agent.ts";

export interface TitleGitSignals {
  /** 当前分支名；分离头指针或无 git 时缺席。 */
  branch?: string;
  /** 本轮改动文件的 basename，去重后已裁到上限；无 git / 无改动时为空。 */
  changedFiles: readonly string[];
}

export interface AgentSessionTitleDeps {
  /** git 信号；失败返回空集合，绝不抛。 */
  collectGitSignals(input: {
    cwd?: string | undefined;
    gitRoot?: string | undefined;
  }): Promise<TitleGitSignals>;
  /** 用户是否允许模型精修。 */
  isRefineEnabled(): Promise<boolean>;
  /** 用户配置的 launch 命令覆盖；无覆盖返回 undefined。 */
  readAgentCommandOverride(agentId: AgentKind): Promise<string | undefined>;
}

let deps: AgentSessionTitleDeps | null = null;

export function registerAgentSessionTitleDeps(
  next: AgentSessionTitleDeps | null
): void {
  deps = next;
}

export function agentSessionTitleDeps(): AgentSessionTitleDeps | null {
  return deps;
}
