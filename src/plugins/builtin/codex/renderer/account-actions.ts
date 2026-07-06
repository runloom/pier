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
          if (item.id === snap.activeAccountId) {
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
