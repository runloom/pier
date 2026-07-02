import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import type { PluginConfigurationChangeEvent } from "@shared/plugin-settings.ts";

export type { PluginConfigurationChangeEvent } from "@shared/plugin-settings.ts";

/**
 * 插件设置 API — main / renderer context 同形。
 * get 读任意 key 的生效值（用户值 ?? default）；set/reset 仅允许操作
 * 自身 `<pluginId>.` 前缀的 key（context 层断言，对齐 assertDeclaredContribution 惯例）。
 */
export interface PluginConfigurationApi {
  get<T>(key: string): T;
  onDidChange(
    listener: (e: PluginConfigurationChangeEvent) => void
  ): () => void;
  reset(key: string): Promise<void>;
  set(key: string, value: JsonValue): Promise<void>;
}
