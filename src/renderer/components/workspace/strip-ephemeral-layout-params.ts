/**
 * 落盘 layout 前剥离短暂 panel params。
 * 例如审查 tab 的 tabChangeSummary（未提交与状态栏同源、commit/branch 来自审查
 * index；重启后会重算，不应进 JSON）。
 */

/** 不进持久化 layout 的 params 键（全产品共用白名单）。 */
export const EPHEMERAL_LAYOUT_PANEL_PARAM_KEYS = ["tabChangeSummary"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripParams(params: Record<string, unknown>): Record<string, unknown> {
  let changed = false;
  const next = { ...params };
  for (const key of EPHEMERAL_LAYOUT_PANEL_PARAM_KEYS) {
    if (key in next) {
      delete next[key];
      changed = true;
    }
  }
  return changed ? next : params;
}

/**
 * 深拷贝式剥离：返回可能改过 panels 的 layout 对象（dockview toJSON 形状）。
 * 无 ephemeral 字段时返回原引用。
 */
export function stripEphemeralLayoutParams(layout: unknown): unknown {
  if (!(isRecord(layout) && isRecord(layout.panels))) {
    return layout;
  }
  let panelsChanged = false;
  const nextPanels: Record<string, unknown> = {};
  for (const [panelId, panelState] of Object.entries(layout.panels)) {
    if (!(isRecord(panelState) && isRecord(panelState.params))) {
      nextPanels[panelId] = panelState;
      continue;
    }
    const stripped = stripParams(panelState.params);
    if (stripped === panelState.params) {
      nextPanels[panelId] = panelState;
      continue;
    }
    panelsChanged = true;
    nextPanels[panelId] = { ...panelState, params: stripped };
  }
  if (!panelsChanged) {
    return layout;
  }
  return { ...layout, panels: nextPanels };
}
