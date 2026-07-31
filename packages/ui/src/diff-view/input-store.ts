import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import type { PierDiffViewChangeControl, PierDiffViewItem } from "./items.ts";

type DiffViewInputListener = () => void;

/**
 * Pierre 的 React portal 以 renderer 函数为整窗输入。这里把易变的文件控制态
 * 下沉为按 id 订阅的外部快照，使 busy 等局部变化只更新目标文件的 header/hunk。
 */
export interface DiffViewInputStore {
  get(id: string): PierDiffViewItem | undefined;
  getChange(
    id: string,
    changeKey: string
  ): PierDiffViewChangeControl | undefined;
  subscribe(id: string, listener: DiffViewInputListener): () => void;
  subscribeChange(
    id: string,
    changeKey: string,
    listener: DiffViewInputListener
  ): () => void;
  update(inputs: readonly PierDiffViewItem[]): void;
}

export function createDiffViewInputStore(
  inputs: readonly PierDiffViewItem[]
): DiffViewInputStore {
  let inputById = new Map(inputs.map((input) => [input.id, input] as const));
  let controlsById = indexChangeControls(inputs);
  const listenersById = new Map<string, Set<DiffViewInputListener>>();
  const changeListenersById = new Map<
    string,
    Map<string, Set<DiffViewInputListener>>
  >();
  return {
    get(id) {
      return inputById.get(id);
    },
    getChange(id, changeKey) {
      return controlsById.get(id)?.get(changeKey);
    },
    subscribe(id, listener) {
      let listeners = listenersById.get(id);
      if (!listeners) {
        listeners = new Set();
        listenersById.set(id, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners?.delete(listener);
        if (listeners?.size === 0) {
          listenersById.delete(id);
        }
      };
    },
    subscribeChange(id, changeKey, listener) {
      let listenersByChangeKey = changeListenersById.get(id);
      if (!listenersByChangeKey) {
        listenersByChangeKey = new Map();
        changeListenersById.set(id, listenersByChangeKey);
      }
      let listeners = listenersByChangeKey.get(changeKey);
      if (!listeners) {
        listeners = new Set();
        listenersByChangeKey.set(changeKey, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners?.delete(listener);
        if (listeners?.size === 0) {
          listenersByChangeKey?.delete(changeKey);
        }
        if (listenersByChangeKey?.size === 0) {
          changeListenersById.delete(id);
        }
      };
    },
    update(inputs) {
      const nextById = new Map(
        inputs.map((input) => [input.id, input] as const)
      );
      const changedFileIds = new Set<string>();
      const changedControls: {
        readonly changeKey: string;
        readonly id: string;
      }[] = [];
      for (const [id, input] of nextById) {
        const previous = inputById.get(id);
        if (previous === input) {
          continue;
        }
        if (!sameFileInput(previous, input)) {
          changedFileIds.add(id);
        }
        const previousControlsByKey = new Map(
          previous?.changeControls?.map(
            (control) => [control.changeKey, control] as const
          ) ?? []
        );
        const nextControlsByKey = new Map(
          input.changeControls?.map(
            (control) => [control.changeKey, control] as const
          ) ?? []
        );
        const changeKeys = new Set([
          ...previousControlsByKey.keys(),
          ...nextControlsByKey.keys(),
        ]);
        for (const changeKey of changeKeys) {
          if (
            !sameChangeControl(
              previousControlsByKey.get(changeKey),
              nextControlsByKey.get(changeKey)
            )
          ) {
            changedControls.push({ changeKey, id });
          }
        }
      }
      for (const id of inputById.keys()) {
        if (!nextById.has(id)) {
          changedFileIds.add(id);
          for (const control of inputById.get(id)?.changeControls ?? []) {
            changedControls.push({ changeKey: control.changeKey, id });
          }
        }
      }
      const nextControlsById = new Map<
        string,
        Map<string, PierDiffViewChangeControl>
      >();
      for (const [id, input] of nextById) {
        const controls =
          inputById.get(id) === input
            ? controlsById.get(id)
            : new Map(
                input.changeControls?.map(
                  (control) => [control.changeKey, control] as const
                ) ?? []
              );
        nextControlsById.set(id, controls ?? new Map());
      }
      inputById = nextById;
      controlsById = nextControlsById;
      for (const id of changedFileIds) {
        for (const listener of listenersById.get(id) ?? []) {
          listener();
        }
      }
      for (const { changeKey, id } of changedControls) {
        for (const listener of changeListenersById.get(id)?.get(changeKey) ??
          []) {
          listener();
        }
      }
    },
  };
}

function indexChangeControls(
  inputs: readonly PierDiffViewItem[]
): Map<string, Map<string, PierDiffViewChangeControl>> {
  return new Map(
    inputs.map((input) => [
      input.id,
      new Map(
        input.changeControls?.map(
          (control) => [control.changeKey, control] as const
        ) ?? []
      ),
    ])
  );
}

function sameFileInput(
  previous: PierDiffViewItem | undefined,
  next: PierDiffViewItem | undefined
): boolean {
  if (previous === next) {
    return true;
  }
  if (!(previous && next)) {
    return false;
  }
  return (
    previous.cacheKey === next.cacheKey &&
    previous.estimateLines === next.estimateLines &&
    previous.fileDisplay?.path === next.fileDisplay?.path &&
    previous.fileDisplay?.previousPath === next.fileDisplay?.previousPath &&
    previous.fileDisplay?.status === next.fileDisplay?.status &&
    previous.id === next.id &&
    previous.kind === next.kind &&
    previous.lineStats?.additions === next.lineStats?.additions &&
    previous.lineStats?.deletions === next.lineStats?.deletions &&
    previous.patch === next.patch &&
    previous.stageControl?.busy === next.stageControl?.busy &&
    previous.stageControl?.canDiscard === next.stageControl?.canDiscard &&
    previous.stageControl?.pendingAction === next.stageControl?.pendingAction &&
    previous.stageControl?.state === next.stageControl?.state &&
    previous.stageControl?.targetSectionKey ===
      next.stageControl?.targetSectionKey &&
    previous.stateNotice === next.stateNotice
  );
}

function sameChangeControl(
  previous: PierDiffViewChangeControl | undefined,
  next: PierDiffViewChangeControl | undefined
): boolean {
  if (previous === next) {
    return true;
  }
  if (!(previous && next)) {
    return false;
  }
  return (
    previous.busy === next.busy &&
    previous.canRevert === next.canRevert &&
    previous.changeBlockIndex === next.changeBlockIndex &&
    previous.changeKey === next.changeKey &&
    previous.hunkIndex === next.hunkIndex &&
    previous.pendingAction === next.pendingAction &&
    previous.state === next.state &&
    previous.targetSectionKey === next.targetSectionKey
  );
}

export function useDiffViewInputStore(
  inputs: readonly PierDiffViewItem[]
): DiffViewInputStore {
  const storeRef: RefObject<DiffViewInputStore | null> = useRef(null);
  if (storeRef.current === null) {
    storeRef.current = createDiffViewInputStore(inputs);
  }
  const store = storeRef.current;
  useLayoutEffect(() => {
    store.update(inputs);
  }, [inputs, store]);
  return store;
}

export function useDiffViewInput(
  store: DiffViewInputStore,
  id: string
): PierDiffViewItem | undefined {
  const subscribe = useCallback(
    (listener: DiffViewInputListener) => store.subscribe(id, listener),
    [id, store]
  );
  const getSnapshot = useCallback(() => store.get(id), [id, store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useDiffViewChangeControl(
  store: DiffViewInputStore,
  id: string,
  changeKey: string
): PierDiffViewChangeControl | undefined {
  const subscribe = useCallback(
    (listener: DiffViewInputListener) =>
      store.subscribeChange(id, changeKey, listener),
    [changeKey, id, store]
  );
  const getSnapshot = useCallback(
    () => store.getChange(id, changeKey),
    [changeKey, id, store]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
