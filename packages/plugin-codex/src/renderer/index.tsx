import type {
  ExternalRendererPluginContext,
  ExternalRendererPluginModule,
} from "@pier/plugin-api/renderer";
import { AccountsWidget as AccountsWidgetImpl } from "./accounts-widget.tsx";

/**
 * Codex plugin renderer entry (plan Task 10).
 */

export { AccountsWidget } from "./accounts-widget.tsx";

export const plugin: ExternalRendererPluginModule = {
  id: "pier.codex",
  activate(context: ExternalRendererPluginContext): () => void {
    // title 不在注册时硬编码——省略后宿主回退 manifest 本地化标题
    // （locales.zh-CN.missionControlWidgets["pier.codex.accounts"]）。
    const dispose = context.missionControlWidgets.register({
      id: "pier.codex.accounts",
      component: (_props) => AccountsWidgetImpl({ context }),
    });
    return dispose;
  },
};
