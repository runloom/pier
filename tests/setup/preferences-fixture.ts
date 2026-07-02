import type { ProjectPreferencesPatch } from "@shared/contracts/commands.ts";
import {
  type ProjectPreferences,
  projectPreferencesSchema,
} from "@shared/contracts/preferences.ts";

/**
 * 测试用 preferences 对象工厂:单一真源就是 zod schema 的 `.default()`,
 * 保证测试永远和运行时默认对齐。schema 加字段时测试无需改动。
 *
 * overrides 使用 ProjectPreferencesPatch (每字段可选可 undefined), 与主
 * 进程 update 语义一致:显式 undefined 也视为缺省, schema.parse 会填默认。
 * 这样测试可以直接把 update 收到的 patch 原样透传给本工厂。
 *
 * 用法:
 *   makeFakePreferences()                             // 全默认
 *   makeFakePreferences({ theme: "dark" })            // 覆盖单字段
 *   makeFakePreferences({ agentStatusHooks: false })  // 关闭 hook 注入
 */
export function makeFakePreferences(
  overrides: ProjectPreferencesPatch = {}
): ProjectPreferences {
  return projectPreferencesSchema.parse({ ...overrides });
}
