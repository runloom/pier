/**
 * 被动恢复（selection restore）的尝试预算。
 *
 * 恢复由渲染窗口上报触发，而恢复自身会滚动并改变布局，从而产生新的上报——
 * 触发信号与重试动作互为因果。`armNavigation` 又会清掉「同一目标只定位一次」
 * 的守卫、取消稳定帧校验、并把确认水位再抬高一格，三道刹车全部失效，
 * 于是只要选中项一直落不进可见集合，这个环就会一直转（滚动条持续抖动、
 * 条目反复重渲染）。
 *
 * 恢复是尽力而为的便利功能：放弃一次定位，远比让面板停不下来可接受。
 */

export const RESTORE_NAVIGATION_MAX_ATTEMPTS = 3;

export interface RestoreNavigationBudget {
  readonly count: number;
  readonly key: string;
}

/** 换目标或换文档代次都重新获得完整预算。 */
export const EMPTY_RESTORE_NAVIGATION_BUDGET: RestoreNavigationBudget = {
  count: 0,
  key: "",
};

/**
 * 消耗一次恢复预算。
 *
 * 返回 null 表示这一代里已经试满，调用方必须静默放弃（保留选中态，
 * 用户再次点击目录树会走显式路径并重置预算）。
 */
export function spendRestoreNavigationAttempt(
  budget: RestoreNavigationBudget,
  entryKey: string,
  generation: number
): RestoreNavigationBudget | null {
  const key = `${entryKey}\0${generation}`;
  const spent = budget.key === key ? budget.count : 0;
  if (spent >= RESTORE_NAVIGATION_MAX_ATTEMPTS) {
    return null;
  }
  return { count: spent + 1, key };
}
