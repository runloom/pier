/**
 * 同名会话消歧——展示层最后一道地板。
 *
 * 标题是尽力而为的：同一个 agent 在同一个项目里开两个面板、或两次发了同样的
 * prompt，主标题就会完全一样。列表里出现两行一模一样的名字时，用户无法回答
 * 「我要点的是哪个」——这不是标题不准，是身份没被呈现。
 *
 * 这里不改标题的语义，只在**确有重复**时追加稳定序号。定序按「先出现的排前」
 * ——有 `spawnedAt` 时按它升序（用户直觉：(1) 是先开的那个），同刻或缺席时
 * 退回 panelId 字典序保证可复现。同一批面板每次渲染得到同一序号；面板关闭
 * 后序号会前移，这是可理解的，不引入额外持久化。
 */

const ORDINAL_SEPARATOR = " ";

function ordinalSuffix(ordinal: number): string {
  return `${ORDINAL_SEPARATOR}(${ordinal})`;
}

export interface AgentSessionTitleDisambiguationEntry {
  /** 面板身份——序号派生的稳定键（同刻/缺席 spawnedAt 时的定序兜底）。 */
  panelId: string;
  /** 已解析的主标题（resolveAgentSessionTitle().primary）。 */
  primary: string;
  /** 会话建立时刻；有则按它升序，(1) 就是先开的那个。 */
  spawnedAt?: number | undefined;
}

/**
 * 返回 panelId → 展示标题。无重复时原样返回，不追加任何东西。
 */
export function disambiguateAgentSessionTitles(
  entries: readonly AgentSessionTitleDisambiguationEntry[]
): Map<string, string> {
  const byPrimary = new Map<string, AgentSessionTitleDisambiguationEntry[]>();
  for (const entry of entries) {
    const group = byPrimary.get(entry.primary);
    if (group) {
      group.push(entry);
    } else {
      byPrimary.set(entry.primary, [entry]);
    }
  }
  const result = new Map<string, string>();
  for (const [primary, group] of byPrimary) {
    if (group.length === 1) {
      const only = group[0];
      if (only) {
        result.set(only.panelId, primary);
      }
      continue;
    }
    // 先开的排前；panelId 兜底保证序号稳定，不跟着快照枚举顺序抖。
    const ordered = [...group].sort((a, b) => {
      const spawnDiff = (a.spawnedAt ?? 0) - (b.spawnedAt ?? 0);
      if (spawnDiff !== 0) {
        return spawnDiff;
      }
      return a.panelId.localeCompare(b.panelId);
    });
    for (const [index, entry] of ordered.entries()) {
      result.set(entry.panelId, `${primary}${ordinalSuffix(index + 1)}`);
    }
  }
  return result;
}
