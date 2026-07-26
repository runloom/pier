/**
 * 精修的准入控制：每面板单飞、全局并发闸、尝试次数上限，外加首条 prompt
 * 的短期记忆（PromptSubmit 记下，首轮 Stop 用掉）。
 *
 * 没有并发闸的话，5 个面板同时首轮结束就会并发 spawn 5 个 CLI 进程。
 */

/** 同时最多几个精修在跑。 */
const MAX_CONCURRENT_REFINES = 2;

/** 每面板最多试几次（失败允许一次重试，之后永久放弃）。 */
const MAX_REFINE_ATTEMPTS = 2;

/** 记忆表上限——面板一直不结束首轮时的兜底，防止无界增长。 */
const MAX_TRACKED_PANELS = 256;

const firstPrompts = new Map<string, string>();
const attempts = new Map<string, number>();
const inFlight = new Set<string>();

export function panelTitleKey(windowId: string, panelId: string): string {
  return `${windowId}:${panelId}`;
}

function evictOldest<V>(map: Map<string, V>): void {
  if (map.size <= MAX_TRACKED_PANELS) {
    return;
  }
  const oldest = map.keys().next();
  if (!oldest.done) {
    map.delete(oldest.value);
  }
}

/** 只记第一条——后续 prompt 不该改变会话主题。 */
export function rememberFirstPrompt(key: string, snippet: string): void {
  if (firstPrompts.has(key)) {
    return;
  }
  firstPrompts.set(key, snippet);
  evictOldest(firstPrompts);
}

export function firstPromptFor(key: string): string | undefined {
  return firstPrompts.get(key);
}

export type RefineAdmission = "ok" | "busy" | "exhausted";

export function beginRefine(key: string): RefineAdmission {
  if (inFlight.has(key) || inFlight.size >= MAX_CONCURRENT_REFINES) {
    return "busy";
  }
  if ((attempts.get(key) ?? 0) >= MAX_REFINE_ATTEMPTS) {
    return "exhausted";
  }
  attempts.set(key, (attempts.get(key) ?? 0) + 1);
  evictOldest(attempts);
  inFlight.add(key);
  return "ok";
}

/**
 * 成功、或次数用尽 → 这个面板不会再精修了，连同首条 prompt 一起忘掉，
 * 不留悬挂记忆。
 */
export function endRefine(key: string, success: boolean): void {
  inFlight.delete(key);
  if (success || (attempts.get(key) ?? 0) >= MAX_REFINE_ATTEMPTS) {
    forgetPanel(key);
  }
}

export function forgetPanel(key: string): void {
  firstPrompts.delete(key);
  attempts.delete(key);
  inFlight.delete(key);
}

/** 仅测试用：清空模块级状态。 */
export function resetTitleSchedulerForTest(): void {
  firstPrompts.clear();
  attempts.clear();
  inFlight.clear();
}
