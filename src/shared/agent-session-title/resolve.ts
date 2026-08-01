/**
 * 展示层：产品 sessionTitle → Index / 活动行 / 改名初值。
 * **不驱动终端 tab**（tab 走 OSC → cwd，见 terminalPanelDescriptor）。
 */

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
  /** Index 主行等。 */
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
 * 产品会话名展示入口（Index / 活动行等）。
 * 仅 provider / user；无合法来源则占位。不接收 OSC。
 */
export function resolveAgentSessionTitle(
  input: ResolveAgentSessionTitleInput
): ResolvedAgentSessionTitle {
  const { placeholder, secondary } = agentSessionPlaceholder(
    input.agentId,
    input.projectRootPath,
    input.cwd
  );
  const source = input.sessionTitleSource;
  const raw =
    source === "provider" || source === "user"
      ? input.sessionTitle?.trim()
      : undefined;
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
