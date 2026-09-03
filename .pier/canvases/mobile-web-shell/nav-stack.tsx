import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cx } from "./chrome.tsx";

export const PUSH_MS = 220;
/** 过渡结束的兜底（jsdom / 被打断的 transition 不会派发 transitionend）。 */
const SETTLE_MS = PUSH_MS + 80;

export interface StackEntry<T> {
  frame: T;
  id: number;
}

type LayerRole = "top" | "under" | "leaving";

function stillOnStack<T>(
  entry: StackEntry<T>,
  entries: readonly StackEntry<T>[]
): boolean {
  return entries.some((next) => next.id === entry.id);
}

function collectLeaving<T>(
  previous: readonly StackEntry<T>[],
  entries: readonly StackEntry<T>[],
  leaving: readonly StackEntry<T>[]
): StackEntry<T>[] {
  const kept = leaving.filter((entry) => !stillOnStack(entry, entries));
  const extra = previous.filter(
    (entry) =>
      !stillOnStack(entry, entries) &&
      !kept.some((item) => item.id === entry.id)
  );
  return extra.length === 0 ? kept : [...kept, ...extra];
}

function sameLeavingIds<T>(
  current: readonly StackEntry<T>[],
  next: readonly StackEntry<T>[]
): boolean {
  return (
    current.length === next.length &&
    current.every((entry, index) => entry.id === next[index]?.id)
  );
}

/**
 * 一条推入栈：所有层都挂着（保住每层自己的状态），只有顶层可点。
 * 前进：新层从右进，下层左移 25% 并加暗；返回：反向，出场层滑出后卸载。
 * 只动 translate / opacity；`prefers-reduced-motion` 取消位移改 120ms 淡入淡出。
 *
 * 出栈层必须在同一次提交里从 `top` 改成 `leaving`，不能先卸再挂：
 * 否则新实例一上来就在屏外，看不到右滑退场。
 */
export function NavStack<T>(props: {
  entries: readonly StackEntry<T>[];
  render: (frame: T, entry: StackEntry<T>) => ReactNode;
}): ReactNode {
  const [leaving, setLeaving] = useState<StackEntry<T>[]>([]);
  const [snapshot, setSnapshot] = useState(props.entries);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const settle = (id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setLeaving((current) => current.filter((entry) => entry.id !== id));
  };

  const leavingNow = collectLeaving(snapshot, props.entries, leaving);
  if (snapshot !== props.entries) {
    setSnapshot(props.entries);
    if (!sameLeavingIds(leaving, leavingNow)) {
      setLeaving(leavingNow);
    }
  }

  useLayoutEffect(() => {
    const active = new Set(leaving.map((entry) => entry.id));
    for (const [id, timer] of timers.current) {
      if (active.has(id)) {
        continue;
      }
      clearTimeout(timer);
      timers.current.delete(id);
    }
    for (const entry of leaving) {
      if (timers.current.has(entry.id)) {
        continue;
      }
      timers.current.set(
        entry.id,
        setTimeout(() => {
          settle(entry.id);
        }, SETTLE_MS)
      );
    }
  }, [leaving]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) {
        clearTimeout(timer);
      }
      timers.current.clear();
    },
    []
  );

  const topIndex = props.entries.length - 1;
  const layers: { entry: StackEntry<T>; depth: number; role: LayerRole }[] = [
    ...props.entries.map((entry, index) => ({
      depth: index,
      entry,
      role: (index === topIndex ? "top" : "under") as LayerRole,
    })),
    ...leavingNow.map((entry, index) => ({
      depth: props.entries.length + index,
      entry,
      role: "leaving" as LayerRole,
    })),
  ];

  return (
    <div className="relative h-full overflow-hidden bg-background">
      {layers.map(({ depth, entry, role }) => (
        <StackLayer
          animateIn={depth > 0}
          depth={depth}
          key={entry.id}
          onSettled={() => {
            settle(entry.id);
          }}
          role={role}
        >
          {props.render(entry.frame, entry)}
        </StackLayer>
      ))}
    </div>
  );
}

function StackLayer(props: {
  animateIn: boolean;
  children: ReactNode;
  depth: number;
  onSettled: () => void;
  role: LayerRole;
}): ReactNode {
  const [entered, setEntered] = useState(!props.animateIn);

  useEffect(() => {
    if (entered) {
      return;
    }
    if (typeof requestAnimationFrame !== "function") {
      setEntered(true);
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        setEntered(true);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [entered]);

  const offscreen = !entered || props.role === "leaving";
  const under = entered && props.role === "under";

  return (
    <div
      aria-hidden={props.role === "top" ? undefined : true}
      className={cx(
        "absolute inset-0 flex flex-col bg-background transition-[translate,opacity] duration-[220ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:translate-x-0 motion-reduce:duration-[120ms]",
        offscreen && "translate-x-full motion-reduce:opacity-0",
        under && "-translate-x-1/4 pointer-events-none",
        !(offscreen || under) && "translate-x-0"
      )}
      data-slot={props.depth > 0 ? "mobile-slide-overlay" : undefined}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && props.role === "leaving") {
          props.onSettled();
        }
      }}
      style={{ zIndex: props.depth }}
    >
      {props.children}
      <div
        aria-hidden="true"
        className={cx(
          "pointer-events-none absolute inset-0 bg-overlay-scrim transition-opacity duration-[220ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
          under ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
}
