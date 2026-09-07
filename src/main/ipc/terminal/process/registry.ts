import { fromNativePanelKey } from "../panel-id.ts";

/** Physical surface/process receipts, not agent activity or task completion. */
export interface NativeTerminalProcess {
  closed: boolean;
  /** Explicit panel close: destroy the view; do not inject end copy or auto-close siblings. */
  closing?: boolean;
  created: boolean;
  error?: string | undefined;
  exitCode?: number | undefined;
  exited: boolean;
  generation: number;
  inputDisposition?: "native-launch" | "draft" | "unconfirmed" | undefined;
  launchId?: string | undefined;
  lifecycleId: string;
  nativePanelId: string;
  stopping: boolean;
  transferring?: boolean;
}

export function createNativeProcessRegistry() {
  const current = new Map<string, NativeTerminalProcess>();
  // Kept independently of surface/session deletion, including window moves.
  const generations = new Map<string, number>();
  const createEpochs = new Map<string, number>();
  const listeners = new Set<(process: NativeTerminalProcess) => void>();
  const emit = (process: NativeTerminalProcess) => {
    for (const listener of listeners) listener(process);
  };
  const isCurrent = (process: NativeTerminalProcess) =>
    current.get(process.nativePanelId) === process;

  return {
    closeWindow(windowId: number): void {
      const prefix = `${windowId}::`;
      for (const key of new Set([...createEpochs.keys(), ...current.keys()])) {
        if (!key.startsWith(prefix)) continue;
        createEpochs.set(key, (createEpochs.get(key) ?? 0) + 1);
        const process = current.get(key);
        if (process && !process.closed) {
          process.closed = true;
          emit(process);
        }
      }
    },
    creationGuard(nativePanelId: string): () => boolean {
      const epoch = createEpochs.get(nativePanelId) ?? 0;
      createEpochs.set(nativePanelId, epoch);
      return () => (createEpochs.get(nativePanelId) ?? 0) === epoch;
    },
    cancelCreation(nativePanelId: string): void {
      createEpochs.set(
        nativePanelId,
        (createEpochs.get(nativePanelId) ?? 0) + 1
      );
    },
    list: () => [...current.values()],
    begin(
      nativePanelId: string,
      options: {
        savedGeneration?: number | undefined;
        lifecycleId?: string | undefined;
        launchId?: string | undefined;
      } = {}
    ): NativeTerminalProcess {
      const panelId = nativePanelId.slice(nativePanelId.indexOf("::") + 2);
      const generation =
        Math.max(generations.get(panelId) ?? 0, options.savedGeneration ?? 0) +
        1;
      generations.set(panelId, generation);
      const process: NativeTerminalProcess = {
        nativePanelId,
        generation,
        lifecycleId:
          options.lifecycleId === ""
            ? `shell:${generation}`
            : (options.lifecycleId ?? String(generation)),
        launchId: options.launchId,
        created: false,
        closed: false,
        closing: false,
        exited: false,
        stopping: false,
      };
      current.set(nativePanelId, process);
      emit(process);
      return process;
    },
    setTransferring(
      process: NativeTerminalProcess,
      transferring: boolean
    ): void {
      if (isCurrent(process)) {
        process.transferring = transferring;
        emit(process);
      }
    },
    markClosing(process: NativeTerminalProcess): void {
      if (!isCurrent(process) || process.closed) return;
      process.closing = true;
      emit(process);
    },
    get: (nativePanelId: string) => current.get(nativePanelId),
    getForCallback(
      browserWindowId: number,
      nativePanelId: string
    ): NativeTerminalProcess | undefined {
      return (
        current.get(nativePanelId) ??
        current.get(`${browserWindowId}::${fromNativePanelKey(nativePanelId)}`)
      );
    },
    isCurrent,
    created(process: NativeTerminalProcess): void {
      if (!isCurrent(process)) return;
      process.created = true;
      emit(process);
    },
    failed(process: NativeTerminalProcess, error: string): void {
      if (!isCurrent(process) || process.created) return;
      process.error = error;
      process.closed = true;
      emit(process);
    },
    exited(
      nativePanelId: string,
      lifecycleId: string,
      exitCode?: number
    ): boolean {
      const process = current.get(nativePanelId);
      if (!process || process.lifecycleId !== lifecycleId || process.closed)
        return false;
      process.exited = true;
      process.exitCode ??= exitCode;
      emit(process);
      return true;
    },
    closed(process: NativeTerminalProcess): void {
      if (!isCurrent(process)) return;
      process.closed = true;
      emit(process);
    },
    move(source: string, target: string): void {
      const process = current.get(source);
      if (!process || source === target) return;
      createEpochs.set(source, (createEpochs.get(source) ?? 0) + 1);
      current.delete(source);
      process.nativePanelId = target;
      current.set(target, process);
      emit(process);
    },
    inputGuard(nativePanelId: string): () => boolean {
      const process = current.get(nativePanelId);
      return () =>
        Boolean(
          process &&
            current.get(nativePanelId) === process &&
            process.created &&
            !process.exited &&
            !process.closed &&
            !process.stopping &&
            !process.transferring
        );
    },
    subscribe(listener: (process: NativeTerminalProcess) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async waitFor(
      nativePanelId: string,
      predicate: (process: NativeTerminalProcess) => boolean,
      timeoutMs = 10_000
    ): Promise<NativeTerminalProcess | undefined> {
      const matches = (process: NativeTerminalProcess | undefined) =>
        Boolean(process && predicate(process));
      const existing = current.get(nativePanelId);
      if (matches(existing)) return existing;
      return new Promise((resolve) => {
        let settled = false;
        const finish = (process?: NativeTerminalProcess) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          listeners.delete(listener);
          resolve(process);
        };
        const listener = (process: NativeTerminalProcess) => {
          if (process.nativePanelId === nativePanelId && predicate(process))
            finish(process);
        };
        const timer = setTimeout(() => {
          const latest = current.get(nativePanelId);
          finish(matches(latest) ? latest : undefined);
        }, timeoutMs);
        listeners.add(listener);
        const latest = current.get(nativePanelId);
        if (matches(latest)) finish(latest);
      });
    },
  };
}

export type NativeProcessRegistry = ReturnType<
  typeof createNativeProcessRegistry
>;
export const nativeTerminalProcesses = createNativeProcessRegistry();
