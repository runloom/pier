import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import i18next from "i18next";
import type { CSSProperties } from "react";
import { useEffect } from "react";
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
import { AgentsSection } from "@/pages/settings/components/agents-section.tsx";
import { AppearanceSection } from "@/pages/settings/components/appearance-section.tsx";
import { KeybindingsSection } from "@/pages/settings/components/keybindings-section.tsx";
import { PluginConfigurationSection } from "@/pages/settings/components/plugin-configuration-section.tsx";
import { PluginsSection } from "@/pages/settings/components/plugins-section.tsx";
import { TerminalSection } from "@/pages/settings/components/terminal-section.tsx";
import {
  NAV_ITEMS,
  type PluginNavItem,
  pluginIdFromSectionId,
  pluginNavItems,
} from "@/pages/settings/data/appearance-nav.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing.store.ts";

const SIDEBAR_STYLE: CSSProperties = {
  "--sidebar-width": "10rem",
  "--sidebar": "none",
} as CSSProperties;

function NavButton({
  active,
  icon: Icon,
  label,
  onSelect,
  testId,
}: {
  active: boolean;
  icon: (typeof NAV_ITEMS)[number]["icon"];
  label: string;
  onSelect: () => void;
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
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SettingsDialog() {
  const t = useT();
  const open = useSettingsDialogStore((s) => s.isOpen);
  const onOpenChange = useSettingsDialogStore((s) => s.setOpen);
  const activeSection = useSettingsDialogStore((s) => s.activeSection);
  const setActiveSection = useSettingsDialogStore((s) => s.setActiveSection);
  const plugins = usePluginRegistryStore((s) => s.plugins);
  const pluginItems: PluginNavItem[] = pluginNavItems(
    plugins,
    i18next.language
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const route = registerTerminalFullscreenWebOverlay("settings-dialog");
    const releaseWebFocus = requestTerminalWebFocus("settings-dialog");
    return () => {
      releaseWebFocus();
      route.dispose();
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

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-[90vh] max-h-[900px] w-[90vw] max-w-[1200px] flex-col sm:max-w-[1200px]"
        onEscapeKeyDown={(event) => {
          // 字段级(InputRow 等)自己处理 Escape(回弹草稿); 避免 Radix
          // DismissableLayer 的 capture-phase 监听把这次按键也当成"关闭对话框"。
          // 字段的 stopPropagation 拦不住 capture 阶段已经跑过的这次调用,
          // 只能在这里按 event.target 判断是否属于可编辑字段来 preventDefault。
          if (
            event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLTextAreaElement
          ) {
            event.preventDefault();
          }
        }}
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
            {activeSection === "keybindings" ? <KeybindingsSection /> : null}
            {activeSection === "plugins" ? <PluginsSection /> : null}
            {activeSection === "agents" ? <AgentsSection /> : null}
            {activePluginId ? (
              <PluginConfigurationSection pluginId={activePluginId} />
            ) : null}
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
