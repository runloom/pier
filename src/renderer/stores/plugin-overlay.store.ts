/**
 * 插件模态 overlay 状态。全局单例:新 open 顶替当前 overlay(旧的视为关闭)。
 * 渲染与 blocking 生命周期由 components/common/plugin-overlay-host.tsx 承担。
 */
import type { ReactNode } from "react";
import { create } from "zustand";

export interface PluginOverlayRequest {
  id: string;
  /** `open=false` retains the component solely for its primitive-owned exit transition. */
  render: (controls: { close: () => void; open: boolean }) => ReactNode;
}

export interface ActivePluginOverlay extends PluginOverlayRequest {
  instanceId: number;
  pluginId: string;
}

interface PluginOverlayState {
  current: ActivePluginOverlay | null;
}

export const usePluginOverlayStore = create<PluginOverlayState>(() => ({
  current: null,
}));

let nextOverlayInstanceId = 1;

export function openPluginOverlay(
  pluginId: string,
  overlay: PluginOverlayRequest
): void {
  usePluginOverlayStore.setState({
    current: {
      ...overlay,
      instanceId: nextOverlayInstanceId,
      pluginId,
    },
  });
  nextOverlayInstanceId += 1;
}

export function closePluginOverlay(pluginId: string, id: string): void {
  const current = usePluginOverlayStore.getState().current;
  if (current && current.pluginId === pluginId && current.id === id) {
    usePluginOverlayStore.setState({ current: null });
  }
}

export function closeOverlaysForPlugin(pluginId: string): void {
  const current = usePluginOverlayStore.getState().current;
  if (current?.pluginId === pluginId) {
    usePluginOverlayStore.setState({ current: null });
  }
}
