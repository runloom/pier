import type { JSX } from "react";

/**
 * Fallback UI for dockview-restored plugin panels whose contribution is
 * disabled, uninstalled, failed to activate, or not yet registered
 * (design §6.3, plan Task 6). Do not delete the panel — dockview layout
 * survives, and the fallback replaces itself when the plugin becomes
 * available.
 */
export interface PluginPanelUnavailableProps {
  reason?: string;
}

export function PluginPanelUnavailable(
  props: PluginPanelUnavailableProps
): JSX.Element {
  return (
    <div style={{ padding: 16, fontFamily: "sans-serif", opacity: 0.6 }}>
      <h3 style={{ fontSize: 14, margin: 0 }}>Plugin panel unavailable</h3>
      <p style={{ fontSize: 12, marginTop: 8 }}>
        {props.reason ??
          "The plugin providing this panel is disabled, uninstalled, or failed to load."}
      </p>
    </div>
  );
}
