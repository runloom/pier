import { z } from "zod";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

/** plugin-settings.json 的持久化形态 — 只存用户显式设置过的值（平铺 settingKey）。 */
export const pluginSettingsStateSchema = z.object({
  values: z.record(z.string(), jsonValueSchema),
  version: z.literal(1),
});
export type PluginSettingsState = z.infer<typeof pluginSettingsStateSchema>;

/** PIER_BROADCAST.PLUGIN_SETTINGS_CHANGED 载荷：changedKeys + 全量新快照。 */
export interface PluginSettingsChangedPayload {
  changedKeys: string[];
  values: Record<string, JsonValue>;
}
