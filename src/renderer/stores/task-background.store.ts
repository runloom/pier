import {
  emptyTaskBackgroundSnapshot,
  type TaskBackgroundSnapshot,
} from "@shared/contracts/tasks.ts";
import { create } from "zustand";

interface TaskBackgroundState {
  apply(snapshot: TaskBackgroundSnapshot): void;
  error: string | null;
  initialized: boolean;
  snapshot: TaskBackgroundSnapshot;
}

export const useTaskBackgroundStore = create<TaskBackgroundState>((set) => ({
  apply: (snapshot) => set({ error: null, initialized: true, snapshot }),
  error: null,
  initialized: false,
  snapshot: emptyTaskBackgroundSnapshot(),
}));

let unsubscribeBackgroundTasks: (() => void) | null = null;

export async function initTaskBackgroundStore(): Promise<void> {
  unsubscribeBackgroundTasks?.();
  const apply = useTaskBackgroundStore.getState().apply;
  unsubscribeBackgroundTasks = window.pier.tasks.onBackgroundChanged(apply);
  try {
    apply(await window.pier.tasks.backgroundSnapshot());
  } catch (err) {
    useTaskBackgroundStore.setState({
      error: err instanceof Error ? err.message : String(err),
      initialized: true,
    });
  }
}
