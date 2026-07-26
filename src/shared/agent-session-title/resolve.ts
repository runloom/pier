/** 展示层：sessionTitle → tab / Index / 标题栏。**不读 OSC**。 */

import { getAgentCatalogEntry } from "../agent-catalog.ts";
import type { AgentKind } from "../contracts/agent.ts";
import type { AgentSessionTitleSource } from "../contracts/foreground-activity.ts";
import { normalizeAgentSessionTitle } from "./normalize.ts";
import { stripAgentPromptMarkup } from "./strip.ts";

export interface ResolveAgentSessionTitleInput {
  agentId: AgentKind;
  cwd?: string | null | undefined;
  projectRootPath?: string | null | undefined;
  sessionTitle?: string | null | undefined;
  sessionTitleSource?: AgentSessionTitleSource | null | undefined;
}

export interface ResolvedAgentSessionTitle {
  /** 无 sessionTitle 时的 primary（便于测试与调试）。 */
  placeholder: string;
  /** tab / Index 主行 / 标题栏。 */
  primary: string;
  /** Index 副行等可用的项目短名；无路径时缺席。 */
  secondary?: string;
}

/** POSIX basename（终端 / 项目路径在 macOS 上均为 `/` 分隔）。 */
function pathBasename(path: string): string {
  if (path === "" || path === "/") {
    return path;
  }
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function agentSessionPlaceholder(
  agentId: AgentKind,
  projectRootPath?: string | null,
  cwd?: string | null
): { placeholder: string; secondary?: string } {
  const label = getAgentCatalogEntry(agentId)?.label ?? agentId;
  const root = projectRootPath?.trim() || cwd?.trim() || "";
  if (!root) {
    return { placeholder: label };
  }
  const secondary = pathBasename(root);
  if (!secondary || secondary === "/") {
    return { placeholder: label };
  }
  return { placeholder: `${label} · ${secondary}`, secondary };
}

/** 组装 resolver 入参（兼容 exactOptionalPropertyTypes）。 */
export function agentSessionTitleInput(args: {
  agentId: AgentKind;
  cwd?: string | null | undefined;
  projectRootPath?: string | null | undefined;
  sessionTitle?: string | null | undefined;
  sessionTitleSource?: AgentSessionTitleSource | null | undefined;
}): ResolveAgentSessionTitleInput {
  return {
    agentId: args.agentId,
    ...(args.cwd != null && args.cwd !== "" ? { cwd: args.cwd } : {}),
    ...(args.projectRootPath != null && args.projectRootPath !== ""
      ? { projectRootPath: args.projectRootPath }
      : {}),
    ...(args.sessionTitle != null && args.sessionTitle !== ""
      ? { sessionTitle: args.sessionTitle }
      : {}),
    ...(args.sessionTitleSource == null
      ? {}
      : { sessionTitleSource: args.sessionTitleSource }),
  };
}

/**
 * Agent 产品主标题唯一入口。
 * 不接收 OSC / terminalTitle——调用方不得把终端装饰标题传进来。
 */
export function resolveAgentSessionTitle(
  input: ResolveAgentSessionTitleInput
): ResolvedAgentSessionTitle {
  const { placeholder, secondary } = agentSessionPlaceholder(
    input.agentId,
    input.projectRootPath,
    input.cwd
  );
  const raw = input.sessionTitle?.trim();
  // 展示路径也过一遍 strip：历史上已落盘的 `<user_query> …` 脏标题
  // 不用迁移就能正常显示。
  const title =
    raw && !raw.includes("\n")
      ? normalizeAgentSessionTitle(stripAgentPromptMarkup(raw))
      : null;
  return {
    placeholder,
    primary: title ?? placeholder,
    ...(secondary === undefined ? {} : { secondary }),
  };
}
