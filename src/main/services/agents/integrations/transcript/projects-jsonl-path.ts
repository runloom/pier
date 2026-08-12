import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { TranscriptTailReconciler } from "./tail-contracts.ts";

/**
 * Claude 族 projects 布局：`<root>/<cwd-enc>/<sessionId>.jsonl`。
 * hook 常缺 transcriptPath，按 sessionId 在一层 cwd 目录下扫描。
 */
export async function resolveProjectsSessionJsonlPath(
  event: AgentHookEventPayload,
  projectsRoot: string,
  cache: Map<string, string>
): Promise<string | null> {
  const explicit = event.transcriptPath?.trim();
  if (explicit) {
    return explicit;
  }
  const sessionId = event.sessionId?.trim();
  if (!sessionId) {
    return null;
  }
  const cached = cache.get(sessionId);
  if (cached) {
    const cachedStat = await stat(cached).catch(() => null);
    if (cachedStat?.isFile()) {
      return cached;
    }
    cache.delete(sessionId);
  }
  const resolved = await findSessionJsonlUnderProjects(projectsRoot, sessionId);
  // SessionStart 常早于 jsonl 落盘；只缓存命中，后续 observe 可重扫。
  if (resolved) {
    cache.set(sessionId, resolved);
    if (cache.size > 256) {
      const first = cache.keys().next().value;
      if (first !== undefined) {
        cache.delete(first);
      }
    }
  }
  return resolved;
}

/** `projects/<cwd-enc>/<sessionId>.jsonl` 一层扫描。 */
export async function findSessionJsonlUnderProjects(
  projectsRoot: string,
  sessionId: string
): Promise<string | null> {
  const entries = await readdir(projectsRoot, { withFileTypes: true }).catch(
    () => null
  );
  if (!entries) {
    return null;
  }
  const fileName = `${sessionId}.jsonl`;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = join(projectsRoot, entry.name, fileName);
    try {
      const st = await stat(candidate);
      if (st.isFile()) {
        return candidate;
      }
    } catch {
      // 继续扫其它 cwd 编码目录
    }
  }
  return null;
}

/**
 * 包装 tail reconciler：无 transcriptPath 时按 sessionId 解析 projects JSONL。
 * SessionEnd 仍交给 inner（释放 owner）。
 */
export function wrapClaudeFamilyProjectsPathResolve(args: {
  agent: AgentKind;
  inner: TranscriptTailReconciler;
  pathCache: Map<string, string>;
  projectsRoot: string;
}): TranscriptTailReconciler {
  const { agent, inner, pathCache, projectsRoot } = args;
  return {
    dispose: () => {
      pathCache.clear();
      inner.dispose();
    },
    observe: async (event: AgentHookEventPayload) => {
      if (event.agent !== agent) {
        return;
      }
      if (event.event === "SessionEnd") {
        await inner.observe(event);
        return;
      }
      const resolved = await resolveProjectsSessionJsonlPath(
        event,
        projectsRoot,
        pathCache
      );
      if (!resolved) {
        return;
      }
      await inner.observe({ ...event, transcriptPath: resolved });
    },
    releasePanel: (panelId, windowId) => {
      inner.releasePanel(panelId, windowId);
    },
    releasePanelsWhere: (predicate) => {
      inner.releasePanelsWhere(predicate);
    },
    releaseWindow: (windowId) => {
      inner.releaseWindow(windowId);
    },
    transferPanelOwnership: (input) => {
      inner.transferPanelOwnership(input);
    },
  };
}
