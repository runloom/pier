import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";

/**
 * 把聚合器全局快照物化为每个存活窗口的完整 publication。
 * 即使某窗口当前为空也必须返回一项，才能覆盖 renderer 先前 pull 到的陈旧状态。
 */
export function materializeForegroundActivityPublications(
  broadcast: ForegroundActivityBroadcast,
  liveWindowIds: readonly number[]
): ReadonlyArray<{
  payload: ForegroundActivityBroadcast;
  windowId: string;
}> {
  const byWindow = new Map<string, ForegroundActivityBroadcast["activities"]>();
  for (const activity of broadcast.activities) {
    const activities = byWindow.get(activity.windowId) ?? [];
    activities.push(activity);
    byWindow.set(activity.windowId, activities);
  }
  return liveWindowIds.map((electronWindowId) => {
    const windowId = String(electronWindowId);
    return {
      payload: {
        activities: byWindow.get(windowId) ?? [],
        ts: broadcast.ts,
      },
      windowId,
    };
  });
}
