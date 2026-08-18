import { afterEach, describe, expect, it } from "vitest";
import { createPluginAppearanceContext } from "@/lib/plugins/host/appearance-context.ts";
import { getShikiTheme } from "@/lib/theme/preset-registry.ts";
import { useThemeStore } from "@/stores/theme.store.ts";

const originalTheme = useThemeStore.getState();

afterEach(() => {
  useThemeStore.setState({
    resolvedTheme: originalTheme.resolvedTheme,
    stylePresetId: originalTheme.stylePresetId,
  });
});

describe("plugin appearance context", () => {
  it("publishes a structured-clone-safe raw registration for the active code theme", () => {
    useThemeStore.setState({
      resolvedTheme: "dark",
      stylePresetId: "pierre",
    });

    const appearance = createPluginAppearanceContext().current();
    const registration = (
      appearance as typeof appearance & {
        codeThemeRegistration?: unknown;
      }
    ).codeThemeRegistration;

    expect(appearance.codeTheme).toBe(getShikiTheme("pierre", "dark").name);
    expect(registration).toEqual(getShikiTheme("pierre", "dark"));
    expect(structuredClone(registration)).toEqual(registration);
  });
});
