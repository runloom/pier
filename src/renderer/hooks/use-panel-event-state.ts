import { useEffect, useRef, useState } from "react";

/**
 * 订阅一个跨进程 panel-scoped 事件流, 按 panelId 过滤后把 extract 出的字段存入
 * React state. 适用于 terminal-panel 这类"single global listener + per-panel
 * filter"的场景 (cwd / OSC title / 未来 bell / focus 都同模式).
 *
 * 空字符串 / null / undefined 一律视为"无变化"忽略 — IPC 边界协议允许空载荷
 * (vim set notitle / tmux detach / shell precmd 重置), 不应让 sink 退到 fallback,
 * 应保留上一次有效值.
 *
 * @param subscribe  preload 暴露的订阅函数, 返回 dispose. 引用必须稳定 (contextBridge
 *                   提供的 API 天然满足).
 * @param panelId    本 panel 的 id, 用于在 callback 中按 event.panelId 过滤.
 * @param extract    从 event 提取目标字段的函数. 允许 inline lambda — hook 内用
 *                   useRef 保最新引用, 避免 re-subscribe.
 */
export function usePanelEventState<E extends { panelId: string }, V>(
  subscribe: (cb: (event: E) => void) => () => void,
  panelId: string,
  extract: (event: E) => V | null | undefined
): V | null {
  const [value, setValue] = useState<V | null>(null);

  // extract 通常是 inline lambda, 每次渲染新引用. useRef 让 effect 总是用最新的
  // 但不把 extract 放进 deps — 避免每次渲染 re-subscribe + re-add listener.
  const extractRef = useRef(extract);
  extractRef.current = extract;

  useEffect(() => {
    const dispose = subscribe((event) => {
      if (event.panelId !== panelId) {
        return;
      }
      const next = extractRef.current(event);
      if (next === null || next === undefined || next === "") {
        return;
      }
      setValue(next);
    });
    return dispose;
  }, [panelId, subscribe]);

  return value;
}
