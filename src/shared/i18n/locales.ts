/**
 * 界面语言单一来源。main / renderer / 契约都从这里派生，不要再写第二份枚举。
 *
 * 产品词（翻译前冻结，禁止把英文实现词打进前台）：
 * | zh-CN     | ja           | ko        |
 * | 智能体    | エージェント | 에이전트  |
 * | 工作树    | 作業ツリー   | 작업 트리 |
 * | 工作台    | ワークベンチ | 워크벤치  |
 * | 组件      | コンポーネント | 컴포넌트 |
 * | 物料      | マテリアル   | 머티리얼  |
 * | 需要你处理 | 対応が必要  | 처리 필요 |
 */
export const SUPPORTED_LOCALES = ["zh-CN", "en", "ja", "ko"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LANGUAGE_PREFERENCE = "system" as const;
export type LanguagePreference =
  | typeof DEFAULT_LANGUAGE_PREFERENCE
  | SupportedLocale;

export const LANGUAGE_PREFERENCE_VALUES = [
  DEFAULT_LANGUAGE_PREFERENCE,
  ...SUPPORTED_LOCALES,
] as const;

export const FALLBACK_LOCALE: SupportedLocale = "en";

/** 语言本名，设置项与命令面板始终用此写法，不随界面语言改。 */
export const LOCALE_NATIVE_NAMES = {
  en: "English",
  ja: "日本語",
  ko: "한국어",
  "zh-CN": "简体中文",
} as const satisfies Record<SupportedLocale, string>;

function normalizeLocaleTag(tag: string): string {
  return tag.trim().toLowerCase().replaceAll("_", "-");
}

/**
 * 系统语言 → 已支持界面语言。
 * 所有中文标签（含繁体 zh-TW / zh-Hant / zh-HK）落到简体。
 */
export function resolveSystemLocaleFromTags(
  tags: readonly string[]
): SupportedLocale {
  for (const tag of tags) {
    const normalized = normalizeLocaleTag(tag);
    if (normalized === "zh" || normalized.startsWith("zh-")) {
      return "zh-CN";
    }
    if (normalized === "ja" || normalized.startsWith("ja-")) {
      return "ja";
    }
    if (normalized === "ko" || normalized.startsWith("ko-")) {
      return "ko";
    }
    if (normalized === "en" || normalized.startsWith("en-")) {
      return "en";
    }
  }
  return FALLBACK_LOCALE;
}

export function resolveLanguagePreferenceFrom(
  language: LanguagePreference,
  systemLocale: SupportedLocale
): SupportedLocale {
  return language === "system" ? systemLocale : language;
}

/** 偏好 + 系统标签 → 界面语言。读取偏好失败时 language 传 undefined。 */
export function resolveUiLocale(
  language: LanguagePreference | undefined,
  systemTags: readonly string[]
): SupportedLocale {
  const systemLocale = resolveSystemLocaleFromTags(systemTags);
  if (!language) {
    return systemLocale;
  }
  return resolveLanguagePreferenceFrom(language, systemLocale);
}

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
