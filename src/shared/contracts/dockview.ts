// 给受 depcruise 约束（不能直接 import dockview）的插件代码提供 dockview 类型。
// 纯类型 re-export，无运行时副作用；未来换 dockview 只改这一处。
export type { IDockviewPanelProps } from "dockview-react";

/** 插件共享 group 视图只需这组结构，避免深依赖 dockview 实现类。 */
export interface PierDockviewGroupHandle {
  readonly activePanel?: PierDockviewPanelHandle | undefined;
  readonly api: {
    onDidActivePanelChange: (listener: (event: unknown) => void) => {
      dispose: () => void;
    };
  };
  readonly element?: HTMLElement;
  readonly id: string;
  readonly model?: {
    readonly activePanel?: PierDockviewPanelHandle | undefined;
    readonly element?: HTMLElement;
  };
}

export interface PierDockviewPanelHandle {
  readonly api?: {
    readonly onDidParametersChange?: (listener: (event: unknown) => void) => {
      dispose: () => void;
    };
  };
  readonly id: string;
  /** dockview 权威 params(context/source/pinned/dirty);拉取式读取。 */
  readonly params?: Record<string, unknown>;
  readonly view?: {
    readonly contentComponent?: string;
  };
}
