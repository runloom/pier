import { TASK_EXIT_TITLE_PREFIX } from "@shared/contracts/tasks.ts";

export function parseTaskExitTitle(title: string): number | null {
  if (!title.startsWith(TASK_EXIT_TITLE_PREFIX)) {
    return null;
  }
  const code = Number.parseInt(title.slice(TASK_EXIT_TITLE_PREFIX.length), 10);
  if (!Number.isFinite(code)) {
    return null;
  }
  return code < 0 ? 1 : code;
}
