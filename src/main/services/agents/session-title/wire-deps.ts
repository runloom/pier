/**
 * 把 app-core 已装配的 git / preferences 服务接到标题端口上。
 *
 * 抽到独立文件纯粹是为了让 app-core.ts 不越过 500 行硬上限——这里的依赖
 * 全部来自 app-core 的 services 与 preferences，不引入新边界。
 */

import { titleChangedFileNames } from "@shared/agent-session-title/index.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { GitService } from "../../git-service.ts";
import type { PreferencesService } from "../../preferences-service.ts";
import {
  registerAgentSessionTitleDeps,
  type TitleGitSignals,
} from "./index.ts";

export function wireAgentSessionTitleDeps(args: {
  git: Pick<GitService, "getStatus">;
  preferences: Pick<PreferencesService, "read">;
}): void {
  registerAgentSessionTitleDeps({
    async collectGitSignals({ cwd, gitRoot }): Promise<TitleGitSignals> {
      const root = gitRoot?.trim() || cwd?.trim();
      if (!root) {
        return { changedFiles: [] };
      }
      try {
        const status = await args.git.getStatus(root);
        return {
          changedFiles: titleChangedFileNames(
            status.files.map((file) => file.path)
          ),
          ...(status.branch.branch ? { branch: status.branch.branch } : {}),
        };
      } catch {
        return { changedFiles: [] };
      }
    },
    async isRefineEnabled() {
      return (await args.preferences.read()).agentSessionTitleRefine;
    },
    async readAgentCommandOverride(agentId: AgentKind) {
      return (await args.preferences.read()).agentCommandOverrides[agentId];
    },
  });
}
