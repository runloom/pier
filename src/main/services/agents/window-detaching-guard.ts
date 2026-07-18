const armed = new Set<string>();
/** 关窗后 native 迟到 process-closed 的抑制窗口 */
const DETACH_DISARM_DELAY_MS = 1500;
const pendingDisarm = new Map<string, NodeJS.Timeout>();

export function armDetaching(keys: {
  electronWindowId: string;
  recordId: string;
}): void {
  const pair = `${keys.electronWindowId}\0${keys.recordId}`;
  const pending = pendingDisarm.get(pair);
  if (pending !== undefined) {
    clearTimeout(pending);
    pendingDisarm.delete(pair);
  }
  if (keys.electronWindowId) {
    armed.add(keys.electronWindowId);
  }
  if (keys.recordId) {
    armed.add(keys.recordId);
  }
}

export function disarmDetaching(keys: {
  electronWindowId: string;
  recordId: string;
}): void {
  const pair = `${keys.electronWindowId}\0${keys.recordId}`;
  const pending = pendingDisarm.get(pair);
  if (pending !== undefined) {
    clearTimeout(pending);
    pendingDisarm.delete(pair);
  }
  armed.delete(keys.electronWindowId);
  armed.delete(keys.recordId);
}

/** 延迟解除抑制，吸收 detachWindow 后迟到的 process-closed / command_finished */
export function scheduleDisarmDetaching(keys: {
  electronWindowId: string;
  recordId: string;
}): void {
  const pair = `${keys.electronWindowId}\0${keys.recordId}`;
  const existing = pendingDisarm.get(pair);
  if (existing !== undefined) {
    clearTimeout(existing);
  }
  pendingDisarm.set(
    pair,
    setTimeout(() => {
      pendingDisarm.delete(pair);
      armed.delete(keys.electronWindowId);
      armed.delete(keys.recordId);
    }, DETACH_DISARM_DELAY_MS)
  );
}

export function isWindowDetaching(key: string): boolean {
  return key.length > 0 && armed.has(key);
}
