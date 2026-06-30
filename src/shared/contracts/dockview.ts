// 给受 depcruise 约束（不能直接 import dockview）的插件代码提供 dockview 类型。
// 纯类型 re-export，无运行时副作用；未来换 dockview 只改这一处。
export type { IDockviewPanelProps } from "dockview-react";
