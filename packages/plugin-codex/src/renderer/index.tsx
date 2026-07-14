import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";
import type { ReactNode } from "react";
import { AccountsSettingsPage } from "./accounts-settings-page.tsx";
import {
  AccountsWidget as AccountsWidgetImpl,
  accountsWidgetActions,
} from "./accounts-widget.tsx";
import rendererStyles from "./styles.css?inline";

/**
 * Codex plugin renderer entry.
 *
 * 成本呈现自 v1.2 起归宿主工作台 `core.cost-overview` 物料统一负责。
 * Codex 只保留账号 + 用量采集职责；成本 UI 三件套（widget/card/visualization）
 * 已在 v1.2 版本删除，历史布局中的 `pier.codex.cost` 会走宿主 unknown widget
 * fallback 显示占位卡供用户手工替换。
 */

export { AccountsWidget } from "./accounts-widget.tsx";

function CodexRendererRoot({ children }: { children: ReactNode }) {
  return (
    <div className="contents" data-pier-codex-scope="">
      {children}
    </div>
  );
}

export const plugin: ExternalRendererPluginModule = {
  id: "pier.codex",
  activate(context: ExternalRendererPluginContext): () => void {
    const styleElement = document.createElement("style");
    styleElement.dataset.pluginId = "pier.codex";
    styleElement.textContent = rendererStyles;
    document.head.appendChild(styleElement);

    const disposeAccountsWidget = context.workbenchWidgets.register({
      id: "pier.codex.accounts",
      // 自定义 async refresh action：接管 refreshable=false 的位置，让 header
      // 按钮的 spinner 反映真实 RPC 时长（防两个 loading 指示同时出现）。
      actions: (actionContext) => accountsWidgetActions(context, actionContext),
      component: (props) => (
        <CodexRendererRoot>
          <AccountsWidgetImpl context={context} {...props} />
        </CodexRendererRoot>
      ),
    });
    const disposeSettings = context.settingsPages.register({
      id: "pier.codex.accounts",
      component: () => (
        <CodexRendererRoot>
          <AccountsSettingsPage context={context} />
        </CodexRendererRoot>
      ),
    });
    return () => {
      disposeAccountsWidget();
      disposeSettings();
      styleElement.remove();
    };
  },
};
