import type { RendererPluginContext } from "@plugins/api/renderer.ts";

export function registerCodexActions(
  context: RendererPluginContext
): () => void {
  const disposeSwitchAccount = context.actions.register({
    category: "Codex",
    handler: () => {
      const snap = context.accounts.snapshot();
      const items = snap.accounts.map((account) => ({
        checked: account.id === snap.activeAccountId,
        id: account.id,
        label: account.email,
      }));

      context.commandPalette.openQuickPick({
        items,
        async onAccept(item) {
          // 用 accept 时刻的实时快照判活跃账号，而非 palette 打开时的闭包快照：
          // 打开期间外部/漂移可能已改活跃账号，用陈旧 snap 会误判为"已是活跃"
          // 而静默 early-return，用户以为切了实际没切。
          const live = context.accounts.snapshot();
          if (item.id === live.activeAccountId) {
            return;
          }

          const confirmSwitch =
            context.configuration.get<boolean>("pier.codex.confirmSwitch") ??
            true;

          if (confirmSwitch) {
            const confirmed = await context.dialogs.confirm({
              body: context.i18n.t(
                "widget.accounts.confirmSwitch.body",
                undefined,
                "Switching accounts affects all terminals, including those outside Pier. Running Codex sessions may be disrupted."
              ),
              title: context.i18n.t(
                "widget.accounts.confirmSwitch.title",
                { email: item.label },
                `Switch to ${item.label}?`
              ),
            });
            if (!confirmed) {
              return;
            }
          }

          try {
            await context.accounts.select(item.id);
          } catch (error) {
            context.notifications.error(
              context.i18n.t(
                "widget.accounts.switchFailed",
                undefined,
                "Failed to switch account"
              ),
              {
                description:
                  error instanceof Error ? error.message : String(error),
              }
            );
          }
        },
        title: context.i18n.commandTitle(
          "pier.codex.switchAccount",
          "Codex: Switch Account"
        ),
      });
    },
    id: "pier.codex.switchAccount",
    metadata: { categoryKey: "settings", sortOrder: 10 },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle(
        "pier.codex.switchAccount",
        "Codex: Switch Account"
      ),
  });

  const disposeAddAccount = context.actions.register({
    category: "Codex",
    handler: async () => {
      const loading = context.notifications.loading(
        context.i18n.t(
          "widget.accounts.loginPending",
          undefined,
          "Complete login in your browser…"
        )
      );
      try {
        await context.accounts.add("codex");
        loading.success(
          context.i18n.t(
            "widget.accounts.addSuccess",
            undefined,
            "Account added"
          )
        );
      } catch (error) {
        loading.dismiss();
        // 用户主动取消（AbortError 哨兵）：静默，不弹失败 toast
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        context.notifications.error(
          context.i18n.t(
            "widget.accounts.addFailed",
            undefined,
            "Failed to add account"
          ),
          {
            description: error instanceof Error ? error.message : String(error),
          }
        );
      }
    },
    id: "pier.codex.addAccount",
    metadata: { categoryKey: "settings", sortOrder: 20 },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle("pier.codex.addAccount", "Codex: Add Account"),
  });

  const disposeRefreshUsage = context.actions.register({
    category: "Codex",
    handler: async () => {
      await context.accounts.refreshUsage();
    },
    id: "pier.codex.refreshUsage",
    metadata: { categoryKey: "settings", sortOrder: 30 },
    surfaces: ["command-palette"],
    title: () =>
      context.i18n.commandTitle(
        "pier.codex.refreshUsage",
        "Codex: Refresh Usage"
      ),
  });

  return () => {
    disposeSwitchAccount();
    disposeAddAccount();
    disposeRefreshUsage();
  };
}
