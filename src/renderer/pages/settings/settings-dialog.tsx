import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/primitives/dialog.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/primitives/sidebar.tsx";
import { useT } from "@/i18n/use-t.ts";
import { AppearanceSection } from "@/pages/settings/components/appearance-section.tsx";
import { KeybindingsSection } from "@/pages/settings/components/keybindings-section.tsx";
import { PluginsSection } from "@/pages/settings/components/plugins-section.tsx";
import { TerminalSection } from "@/pages/settings/components/terminal-section.tsx";
import {
  NAV_ITEMS,
  type SettingsSectionId,
} from "@/pages/settings/data/appearance-nav.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  registerWebFocusScope,
} from "@/stores/terminal-input-routing.store.ts";

const SIDEBAR_STYLE: CSSProperties = {
  "--sidebar-width": "10rem",
  "--sidebar": "none",
} as CSSProperties;

export function SettingsDialog() {
  const t = useT();
  const open = useSettingsDialogStore((s) => s.isOpen);
  const onOpenChange = useSettingsDialogStore((s) => s.setOpen);
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("appearance");

  useEffect(() => {
    if (!open) {
      return;
    }
    const route = registerTerminalFullscreenWebOverlay("settings-dialog");
    const disposeScope = registerWebFocusScope("settings-dialog", "exclusive");
    return () => {
      disposeScope();
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

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[90vh] max-h-[900px] w-[90vw] max-w-[1200px] flex-col sm:max-w-[1200px]">
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
                  {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          aria-current={
                            activeSection === item.id ? "page" : undefined
                          }
                          isActive={activeSection === item.id}
                          onClick={() => setActiveSection(item.id)}
                          type="button"
                        >
                          <Icon />
                          <span>{t(`settings.nav.${item.id}`)}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
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
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
