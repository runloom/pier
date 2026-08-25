import type { PanelContext } from "@shared/contracts/panel.ts";
import type {
  TaskOutputPanelParams,
  TaskPanelMetadata,
} from "@shared/contracts/tasks.ts";
import type { CreateTerminalArgs } from "@shared/contracts/terminal.ts";
import type { IDockviewPanelProps } from "dockview-react";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { useT } from "@/i18n/use-t.ts";
import { runTerminalNativeLifecycleEffect } from "./native-lifecycle-effect.ts";

interface UseTerminalNativeLifecycleArgs {
  anchorRef: RefObject<HTMLDivElement | null>;
  api: IDockviewPanelProps["api"];
  /** 后台创建（agents.start 委派）：挂载即建面，跳过可见性/真实尺寸门控。 */
  backgroundCreate: boolean | undefined;
  effectiveMonoFontSize: number;
  initialContext: PanelContext | undefined;
  initialInput: string | undefined;
  initialInputSubmit: boolean | undefined;
  initialLaunchId: string | undefined;
  initialTab: CreateTerminalArgs["tab"] | undefined;
  initialTask: TaskPanelMetadata | undefined;
  initialTaskOutput: TaskOutputPanelParams | undefined;
  monoFontFamily: string;
  panelId: string;
  retryNonce: number;
  sessionLoaded: boolean;
  setCreateError: (error: string) => void;
  setNativeTerminalReady: (ready: boolean) => void;
  skipNativeCreate: boolean;
}

export function useTerminalNativeLifecycle({
  api,
  anchorRef,
  backgroundCreate,
  effectiveMonoFontSize,
  initialContext,
  initialInput,
  initialInputSubmit,
  initialLaunchId,
  initialTab,
  initialTask,
  initialTaskOutput,
  monoFontFamily,
  panelId,
  retryNonce,
  sessionLoaded,
  setCreateError,
  setNativeTerminalReady,
  skipNativeCreate,
}: UseTerminalNativeLifecycleArgs): void {
  const monoFontFamilyRef = useRef(monoFontFamily);
  const effectiveMonoFontSizeRef = useRef(effectiveMonoFontSize);
  const t = useT();
  const translateRef = useRef(t);
  useLayoutEffect(() => {
    monoFontFamilyRef.current = monoFontFamily;
    effectiveMonoFontSizeRef.current = effectiveMonoFontSize;
    translateRef.current = t;
  }, [effectiveMonoFontSize, monoFontFamily, t]);
  const lifecycleVersionRef = useRef(0);

  useEffect(
    () =>
      runTerminalNativeLifecycleEffect({
        anchorRef,
        api,
        backgroundCreate,
        effectiveMonoFontSizeRef,
        initialContext,
        initialInput,
        initialInputSubmit,
        initialLaunchId,
        initialTab,
        initialTask,
        initialTaskOutput,
        lifecycleVersionRef,
        monoFontFamilyRef,
        panelId,
        retryNonce,
        sessionLoaded,
        setCreateError,
        setNativeTerminalReady,
        skipNativeCreate,
        translateRef,
      }),
    [
      api,
      anchorRef,
      backgroundCreate,
      initialContext,
      initialInput,
      initialInputSubmit,
      initialLaunchId,
      initialTab,
      initialTask,
      initialTaskOutput,
      panelId,
      retryNonce,
      sessionLoaded,
      skipNativeCreate,
      setCreateError,
      setNativeTerminalReady,
    ]
  );
}
