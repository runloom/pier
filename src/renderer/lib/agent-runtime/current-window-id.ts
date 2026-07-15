import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

let cachedElectronWindowId: string | undefined;
let contextSeedStarted = false;

function seedFromWindowContext(): void {
  if (contextSeedStarted || typeof window === "undefined") {
    return;
  }
  contextSeedStarted = true;
  const api = window.pier?.window?.getContext;
  if (!api) {
    return;
  }
  api()
    .then((context) => {
      const id = context.electronWindowId;
      if (typeof id === "string" && id.length > 0) {
        cachedElectronWindowId = id;
      }
    })
    .catch(() => undefined);
}

/**
 * 当前窗 electron windowId（与 FA / Index 词汇对齐）。
 * 优先模块缓存（由 WindowContext.electronWindowId 或 FA 写入），不再只靠 activities[0]。
 */
export function currentElectronWindowId(): string | undefined {
  if (cachedElectronWindowId !== undefined) {
    return cachedElectronWindowId;
  }
  seedFromWindowContext();
  const activities = Object.values(
    useForegroundActivityStore.getState().activities
  );
  const fromFa = activities[0]?.windowId;
  if (fromFa) {
    cachedElectronWindowId = fromFa;
    return fromFa;
  }
  return;
}

/** FA bridge / 测试写入。 */
export function rememberElectronWindowId(id: string): void {
  if (id.length === 0) {
    return;
  }
  cachedElectronWindowId = id;
}

export function resetElectronWindowIdForTests(): void {
  cachedElectronWindowId = undefined;
  contextSeedStarted = false;
}
