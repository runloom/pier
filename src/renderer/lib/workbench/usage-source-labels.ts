import type { TFunction } from "i18next";

/**
 * usage-data source id → 友好显示名的 renderer 端映射表。
 *
 * 覆盖 `src/main/services/agents/usage-collectors/*` 里所有 collector 的
 * source id（都以 `-local-sessions` 结尾）。新增 collector 时**同步这里**，
 * 否则 chart legend 会显示技术 id 而非产品名。
 *
 * 只做展示层映射；聚合、计价、去重等域逻辑完全走 `sourceId` 本身。
 */
interface SourceDisplay {
  /** 出现在物料 chart legend + tooltip 的中性产品名（i18n key）。 */
  readonly i18nKey: string;
  readonly sourceId: string;
}

const KNOWN_SOURCES: readonly SourceDisplay[] = [
  {
    i18nKey: "workbench.widget.costOverview.sourceName.codex",
    sourceId: "codex-local-sessions",
  },
  {
    i18nKey: "workbench.widget.costOverview.sourceName.claudeCode",
    sourceId: "claude-code-local-sessions",
  },
  {
    i18nKey: "workbench.widget.costOverview.sourceName.opencode",
    sourceId: "opencode-local-sessions",
  },
  {
    i18nKey: "workbench.widget.costOverview.sourceName.pi",
    sourceId: "pi-local-sessions",
  },
  {
    i18nKey: "workbench.widget.costOverview.sourceName.omp",
    sourceId: "omp-local-sessions",
  },
];

const KNOWN_BY_SOURCE_ID: ReadonlyMap<string, SourceDisplay> = new Map(
  KNOWN_SOURCES.map((entry) => [entry.sourceId, entry])
);

/**
 * 解析源 id 到用户可读名。已知源 → i18n 翻译；未知 → 保留 `pluginId/sourceId`
 * 形式帮助诊断（罕见路径：外部插件或未来 collector 未接入本表）。
 */
export function resolveUsageSourceLabel(
  t: TFunction,
  pluginId: string,
  sourceId: string
): string {
  const known = KNOWN_BY_SOURCE_ID.get(sourceId);
  if (known) return t(known.i18nKey);
  return `${pluginId}/${sourceId}`;
}

/**
 * 内置支持来源的产品名列表（逗号分隔），用于物料空态提示。
 * 顺序跟 `KNOWN_SOURCES` 一致，即注册顺序，便于阅读。
 */
export function listSupportedUsageSourceLabels(t: TFunction): string {
  return KNOWN_SOURCES.map((entry) => t(entry.i18nKey)).join(
    t("workbench.widget.costOverview.sourceName.separator")
  );
}
