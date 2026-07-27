import type { CreateMode } from "./worktree-create-form.tsx";

const CREATE_MODE_KEY = "pier.git.worktree.createMode";
const START_TASK_KEY = "pier.git.worktree.createStartTask";
const DEFAULT_CREATE_MODE: CreateMode = "ai";
const DEFAULT_START_TASK = false;

function createPrefsStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 新建工作树的命名方式偏好(智能生成 / 手动命名);全局持久化,跨弹窗与窗口共享。
 * 只记录用户显式切换的 tab —— AI 不可用时的强制回落不写入。
 */
export function readWorktreeCreateMode(): CreateMode {
  try {
    const raw = createPrefsStorage()?.getItem(CREATE_MODE_KEY);
    return raw === "ai" || raw === "custom" ? raw : DEFAULT_CREATE_MODE;
  } catch {
    return DEFAULT_CREATE_MODE;
  }
}

export function writeWorktreeCreateMode(mode: CreateMode): void {
  try {
    createPrefsStorage()?.setItem(CREATE_MODE_KEY, mode);
  } catch {
    // 存储不可用时仅保留会话内选择
  }
}

/**
 * 「立即开始任务」开关偏好;全局持久化。
 * 无可用智能体时会话内会强制关,但不清缓存——恢复可用后仍按上次选择。
 */
export function readWorktreeCreateStartTask(): boolean {
  try {
    const raw = createPrefsStorage()?.getItem(START_TASK_KEY);
    return raw === "1" || raw === "true";
  } catch {
    return DEFAULT_START_TASK;
  }
}

export function writeWorktreeCreateStartTask(startTask: boolean): void {
  try {
    createPrefsStorage()?.setItem(START_TASK_KEY, startTask ? "1" : "0");
  } catch {
    // 存储不可用时仅保留会话内选择
  }
}
