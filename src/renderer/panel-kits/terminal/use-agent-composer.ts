import type { IDockviewPanelProps } from "dockview-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  requestTerminalFocusIntent,
  setTerminalNativeFocusDisabled,
} from "@/stores/terminal-input-routing-slice.ts";
import {
  TERMINAL_COMPOSER_GAP_PX,
  TERMINAL_COMPOSER_RESERVE_HEIGHT_PX,
} from "./terminal-composer.tsx";
import {
  canUseAgentComposer,
  shouldMountAgentComposer,
} from "./terminal-composer-mount.ts";
import { useTerminalComposerOpen } from "./use-terminal-composer-open.ts";

// 从 terminal-panel.tsx 抽出：file-size 纪律（超 500 行硬顶）+ 维持挂载判定单一
// 口径——shouldMountAgentComposer 仍是唯一判定，面板 inset 与组件渲染同口径不变。

export interface UseAgentComposerParams {
  activityKind: string | undefined;
  api: IDockviewPanelProps["api"];
  hasStatusBar: boolean;
  panelId: string;
  restored: boolean;
}

export interface UseAgentComposerResult {
  closeComposer: () => void;
  composerFocusRequest: number;
  composerMounted: boolean;
  onComposerHeightChange: (heightPx: number) => void;
  statusInsetPx: number;
  terminalContentBottomPx: number;
}

export function useAgentComposer({
  api,
  panelId,
  activityKind,
  restored,
  hasStatusBar,
}: UseAgentComposerParams): UseAgentComposerResult {
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const openComposer = useCallback(() => {
    setComposerOpen(true);
    // Already open: still bump so TerminalComposer refocuses (mirrors search).
    setComposerFocusRequest((value) => value + 1);
  }, []);
  const closeComposer = useCallback(() => {
    setComposerOpen(false);
  }, []);
  const activatePanel = useCallback(() => {
    api.setActive();
  }, [api]);

  useTerminalComposerOpen({
    onClose: closeComposer,
    onOpen: openComposer,
    panelId,
    setActive: activatePanel,
  });

  // 资格失效（非 agent / 恢复态）时强制关闭，避免 open 位悬挂。
  useEffect(() => {
    if (!canUseAgentComposer({ activityKind, restored })) {
      setComposerOpen(false);
    }
  }, [activityKind, restored]);

  // 恢复态面板（agent/task 静态结果卡）没有活 PTY，不挂载；挂载判定单一实现
  // （shouldMountAgentComposer），面板 inset 与组件渲染同口径。
  const composerMounted = shouldMountAgentComposer({
    activityKind,
    open: composerOpen,
    restored,
  });
  const [composerHeightPx, setComposerHeightPx] = useState(0);
  const statusInsetPx = hasStatusBar ? 24 : 0; // 与原 bottom-6 等值
  // 首帧用预留高度缩排 native，避免卡片叠在未缩帧上点不中；实测后取真实高度。
  const composerInsetPx = composerMounted
    ? Math.max(composerHeightPx, TERMINAL_COMPOSER_RESERVE_HEIGHT_PX) +
      TERMINAL_COMPOSER_GAP_PX * 2
    : 0;
  const terminalContentBottomPx = statusInsetPx + composerInsetPx;
  // layout 阶段就关原生聚焦 / 光标，尽量赶在首帧绘制前。
  useLayoutEffect(() => {
    if (!composerMounted) {
      return;
    }
    setTerminalNativeFocusDisabled(panelId, true);
    return () => {
      setTerminalNativeFocusDisabled(panelId, false);
    };
  }, [composerMounted, panelId]);

  // agent 退出或关闭（挂载翻转 false）且本面板仍激活时，把键盘归还终端。
  const prevComposerMountedRef = useRef(composerMounted);
  useEffect(() => {
    if (prevComposerMountedRef.current && !composerMounted && api.isActive) {
      requestTerminalFocusIntent(panelId);
    }
    prevComposerMountedRef.current = composerMounted;
  }, [composerMounted, api, panelId]);

  return {
    closeComposer,
    composerFocusRequest,
    composerMounted,
    onComposerHeightChange: setComposerHeightPx,
    statusInsetPx,
    terminalContentBottomPx,
  };
}
