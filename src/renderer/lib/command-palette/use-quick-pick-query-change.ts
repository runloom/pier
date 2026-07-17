/**
 * 命令面板异步搜索的 onQueryChange 触发/取消副作用。
 * 打开时 + 每次 query 变化都调一次 handler, 上一次的 AbortSignal 立即 abort;
 * 面板关闭或 hook 卸载也 abort, 让插件里的 fetch 能可靠退出。
 */
import { useEffect, useRef } from "react";
import type { QuickPick } from "./types.ts";

export function useQuickPickQueryChange(input: {
  handler: QuickPick["onQueryChange"] | undefined;
  isOpen: boolean;
  mode: string;
  query: string;
  requestId: number;
}): void {
  const { handler, isOpen, mode, query, requestId } = input;
  // handler 用 ref 持有：updateQuickPick 常常换 quickPick 引用但同一函数,
  // 我们不希望仅仅因引用变化就重放搜索并 abort in-flight。
  const handlerRef = useRef<QuickPick["onQueryChange"] | undefined>(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  const abortRef = useRef<AbortController | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: requestId 是新 session 的重放 key, 同 query 同 handler 也要 re-fire
  useEffect(() => {
    if (!isOpen || mode !== "quick-pick") {
      return;
    }
    const current = handlerRef.current;
    if (!current) {
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let result: void | Promise<void>;
    try {
      result = current(query, controller.signal);
    } catch (err) {
      console.error("[command-palette] onQueryChange threw:", err);
      return () => {
        controller.abort();
      };
    }
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        console.error("[command-palette] onQueryChange rejected:", err);
      });
    }
    return () => {
      controller.abort();
    };
  }, [isOpen, mode, query, requestId]);
}
