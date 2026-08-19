import { join } from "node:path";
import { app } from "electron";
import type { TerminalTranscriptsService } from "../../../services/terminal-transcripts/index.ts";
import type { NativeAddon } from "../native-addon.ts";
import { fromNativePanelKey } from "../panel-id.ts";
import {
  createTerminalHotWindowPressure,
  type TerminalHotWindowPressure,
} from "./hot-window-pressure.ts";

export function nativePtyTranscriptLifecycleId(input: {
  lifecycleId: string;
  panelId: string;
}): string {
  if (input.lifecycleId.length > 0) {
    return input.lifecycleId;
  }
  const bare = fromNativePanelKey(input.panelId);
  return bare.length > 0 ? `term-${bare}` : `term-${input.panelId}`;
}

/**
 * transcript 根目录、native 活体 id、热窗压力与 set-config 收缩重施压。
 */
export function createTerminalTranscriptWiring(input: {
  addon: NativeAddon | null;
  transcripts?: TerminalTranscriptsService;
}): {
  dispose(): void;
  hotWindowPressure: TerminalHotWindowPressure | null;
  markPtyLive(nativePanelId: string, lifecycleId: string): void;
  observeSnapshot(
    browserWindowId: number,
    entries: ReadonlyArray<{ nativePanelId: string; visible: boolean }>
  ): void;
  onNativeClosed(nativePanelId: string): void;
  onSetConfig(scrollbackLimitBytes: number): void;
} {
  const { addon, transcripts } = input;
  try {
    addon?.setTerminalTranscriptRoot?.(
      join(app.getPath("userData"), "terminal-transcripts")
    );
  } catch (err) {
    console.warn("[terminal] transcript root setup failed:", err);
  }

  const liveByNativePanel = new Map<string, string>();
  const hotWindowPressure = addon?.setTerminalScrollbackLimit
    ? createTerminalHotWindowPressure({
        setScrollbackLimit: (nativePanelId, limitBytes) =>
          addon.setTerminalScrollbackLimit?.(nativePanelId, limitBytes) ??
          false,
      })
    : null;

  function forgetLive(nativePanelId: string): void {
    const lifecycleId = liveByNativePanel.get(nativePanelId);
    if (!lifecycleId) {
      return;
    }
    liveByNativePanel.delete(nativePanelId);
    transcripts?.unmarkNativeLive(lifecycleId);
  }

  return {
    dispose() {
      for (const lifecycleId of liveByNativePanel.values()) {
        transcripts?.unmarkNativeLive(lifecycleId);
      }
      liveByNativePanel.clear();
      hotWindowPressure?.dispose();
    },
    hotWindowPressure,
    markPtyLive(nativePanelId, lifecycleId) {
      const previous = liveByNativePanel.get(nativePanelId);
      if (previous && previous !== lifecycleId) {
        transcripts?.unmarkNativeLive(previous);
      }
      liveByNativePanel.set(nativePanelId, lifecycleId);
      transcripts?.markNativeLive(lifecycleId);
    },
    observeSnapshot(browserWindowId, entries) {
      if (entries.length === 0) {
        const prefix = `${browserWindowId}::`;
        for (const nativePanelId of [...liveByNativePanel.keys()]) {
          if (nativePanelId.startsWith(prefix)) {
            forgetLive(nativePanelId);
          }
        }
      }
      hotWindowPressure?.observeWindowSnapshot(browserWindowId, entries);
    },
    onNativeClosed(nativePanelId) {
      forgetLive(nativePanelId);
    },
    onSetConfig(scrollbackLimitBytes) {
      hotWindowPressure?.setPreferredLimit(scrollbackLimitBytes);
      hotWindowPressure?.reapplyShrunkLimits();
    },
  };
}
