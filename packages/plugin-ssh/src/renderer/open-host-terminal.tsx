import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Server } from "lucide-react";
import {
  buildSshCommand,
  describeSshTarget,
  type SshHost,
  type SshHostsSnapshot,
} from "../shared/hosts.ts";
import type { Translate } from "./translate.ts";

export async function openHostTerminal(options: {
  context: ExternalRendererPluginContext;
  host: SshHost;
  onError: (error: unknown) => void;
  t: Translate;
}): Promise<void> {
  const loading = options.context.notifications.loading(
    options.t("pier.ssh.terminal.opening", "Opening SSH terminal…")
  );
  try {
    await options.context.terminals.open({
      launch: { command: buildSshCommand(options.host) },
    });
    loading.success(
      options.t("pier.ssh.terminal.opened", "SSH terminal opened")
    );
  } catch (error) {
    loading.dismiss();
    options.onError(error);
  }
}

export async function openSshTerminalPicker(options: {
  context: ExternalRendererPluginContext;
  onError: (error: unknown) => void;
  t: Translate;
}): Promise<void> {
  const { context, onError, t } = options;
  let snapshot: SshHostsSnapshot;
  try {
    snapshot = await context.rpc.invoke<SshHostsSnapshot>("hosts.snapshot");
  } catch (error) {
    onError(error);
    throw error;
  }
  if (snapshot.hosts.length === 0) {
    context.notifications.info(
      t(
        "pier.ssh.picker.noHosts",
        "No SSH hosts yet. Add one in Settings first."
      )
    );
    context.app.openSettings({ section: "plugin:pier.ssh" });
    return;
  }

  const hostsById = new Map(snapshot.hosts.map((host) => [host.id, host]));
  context.commandPalette.openQuickPick({
    items: snapshot.hosts.map((host) => ({
      description: describeSshTarget(host),
      icon: Server,
      id: host.id,
      label: host.name,
      searchTerms: [host.host, host.user ?? ""],
    })),
    onAccept: async (item) => {
      const host = hostsById.get(item.id);
      if (!host) {
        return;
      }
      await openHostTerminal({ context, host, onError, t });
    },
    placeholder: t(
      "pier.ssh.picker.description",
      "Choose a host to connect to."
    ),
    title: t("pier.ssh.picker.title", "Open SSH terminal"),
  });
}
