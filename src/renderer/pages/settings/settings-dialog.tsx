import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import i18next from "i18next";
import type { CSSProperties } from "react";
import { useEffect, useSyncExternalStore } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/primitives/sidebar.tsx";
import { useT } from "@/i18n/use-t.ts";
import {
  getPluginSettingsPage,
  getPluginSettingsPageRevision,
  subscribePluginSettingsPageRegistry,
} from "@/lib/plugins/plugin-settings-page-registry.ts";
import { AgentsSection } from "@/pages/settings/components/agents-section.tsx";
import { AppUpdateSection } from "@/pages/settings/components/app-update-section.tsx";
import { AppearanceSection } from "@/pages/settings/components/appearance-section.tsx";
import { EnvironmentSection } from "@/pages/settings/components/environment-section.tsx";
import { KeybindingsSection } from "@/pages/settings/components/keybindings-section.tsx";
import { NotificationsSection } from "@/pages/settings/components/notifications-section.tsx";
import { PluginConfigurationSection } from "@/pages/settings/components/plugin-configuration-section.tsx";
import { PluginsSection } from "@/pages/settings/components/plugins-section.tsx";
import { TerminalSection } from "@/pages/settings/components/terminal-section.tsx";
import { WorkspaceSection } from "@/pages/settings/components/worktree-section.tsx";
import {
  NAV_ITEMS,
  type PluginNavItem,
  pluginIdFromSectionId,
  pluginNavItems,
} from "@/pages/settings/data/appearance-nav.ts";
import {
  appUpdateNeedsAttention,
  useAppUpdateStore,
} from "@/stores/app-update.store.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { requestTerminalWebFocus } from "@/stores/terminal-input-routing-slice.ts";

const SIDEBAR_STYLE: CSSProperties = {
  "--sidebar-width": "10rem",
  "--sidebar": "none",
} as CSSProperties;

function NavButton({
  active,
  icon: Icon,
  label,
  onSelect,
  showDot,
  testId,
}: {
  active: boolean;
  icon: (typeof NAV_ITEMS)[number]["icon"];
  label: string;
  onSelect: () => void;
  showDot?: boolean;
  testId: string;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        aria-current={active ? "page" : undefined}
        data-testid={testId}
        isActive={active}
        onClick={onSelect}
        type="button"
      >
        <Icon />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate">{label}</span>
          {showDot ? (
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-action-accent"
              data-testid={`${testId}-dot`}
            />
          ) : null}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function PluginSettingsSection({ pluginId }: { pluginId: string }) {
  const customSettingsPage = getPluginSettingsPage(pluginId);
  const CustomSettingsPageComponent = customSettingsPage?.component;
  if (CustomSettingsPageComponent) {
    return <CustomSettingsPageComponent />;
  }
  return <PluginConfigurationSection pluginId={pluginId} />;
}

export function SettingsDialog() {
  const t = useT();
  const open = useSettingsDialogStore((s) => s.isOpen);
  const onOpenChange = useSettingsDialogStore((s) => s.setOpen);
  const activeSection = useSettingsDialogStore((s) => s.activeSection);
  const setActiveSection = useSettingsDialogStore((s) => s.setActiveSection);
  const updateSnapshot = useAppUpdateStore((s) => s.snapshot);
  const updatesNeedAttention = appUpdateNeedsAttention(updateSnapshot);
  const plugins = usePluginRegistryStore((s) => s.plugins);
  const pluginItems: PluginNavItem[] = pluginNavItems(
    plugins,
    i18next.language
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const releaseWebFocus = requestTerminalWebFocus("settings-dialog");
    return () => {
      releaseWebFocus();
    };
  }, [open]);

  useEffect(
    () =>
      window.pier?.settings?.onOpenRequest?.(() => {
        useSettingsDialogStore.getState().open();
      }),
    []
  );

  // activeSection 指向的插件 section 消失（禁用/卸载，含其它窗口触发）→ fallback 到 plugins。
  useEffect(() => {
    const pluginId = pluginIdFromSectionId(activeSection);
    if (pluginId && !pluginItems.some((item) => item.pluginId === pluginId)) {
      setActiveSection("plugins");
    }
  }, [activeSection, pluginItems, setActiveSection]);

  const activePluginId = pluginIdFromSectionId(activeSection);
  useSyncExternalStore(
    subscribePluginSettingsPageRegistry,
    getPluginSettingsPageRevision
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-[90vh] max-h-[900px] w-[90vw] max-w-[1200px] flex-col sm:max-w-[1200px]"
        closeLabel={t("dialog.close")}
        onEscapeKeyDown={(event) => {
          // 设置项以 blur 作为统一提交入口。Radix 通过 Escape 卸载 Dialog 前
          // 主动触发 blur，既保留自动保存语义，也不阻止 Dialog 的标准关闭行为。
          if (event.target instanceof HTMLElement) {
            event.target.blur();
          }
        }}
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>
        <SidebarProvider
          className="min-h-0 flex-1 items-start gap-3"
          style={SIDEBAR_STYLE}
        >
          <Sidebar className="hidden md:flex" collapsible="none">
            <SidebarContent className="overflow-visible">
              <SidebarGroupContent>
                <SidebarMenu>
                  {NAV_ITEMS.map((item) => (
                    <NavButton
                      active={activeSection === item.id}
                      icon={item.icon}
                      key={item.id}
                      label={t(`settings.nav.${item.id}`)}
                      onSelect={() => setActiveSection(item.id)}
                      showDot={item.id === "updates" && updatesNeedAttention}
                      testId={`settings-nav-${item.id}`}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
              {pluginItems.length > 0 ? (
                <SidebarGroup className="p-0">
                  <SidebarGroupLabel>
                    {t("settings.nav.pluginGroup")}
                  </SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {pluginItems.map((item) => (
                        <NavButton
                          active={activeSection === item.id}
                          icon={item.icon}
                          key={item.id}
                          label={item.label}
                          onSelect={() => setActiveSection(item.id)}
                          testId={`settings-nav-plugin-${item.pluginId}`}
                        />
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ) : null}
            </SidebarContent>
          </Sidebar>

          <main
            className="relative -mr-6 flex h-full min-h-0 flex-1 flex-col overflow-y-auto"
            data-scrollbar="stable"
          >
            {activeSection === "appearance" ? <AppearanceSection /> : null}
            {activeSection === "terminal" ? <TerminalSection /> : null}
            {activeSection === "workspace" ? <WorkspaceSection /> : null}
            {activeSection === "keybindings" ? <KeybindingsSection /> : null}
            {activeSection === "updates" ? <AppUpdateSection /> : null}
            {activeSection === "plugins" ? <PluginsSection /> : null}
            {activeSection === "environment" ? <EnvironmentSection /> : null}
            {activeSection === "agents" ? <AgentsSection /> : null}
            {activeSection === "notifications" ? (
              <NotificationsSection />
            ) : null}
            {activePluginId ? (
              <PluginSettingsSection pluginId={activePluginId} />
            ) : null}
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
