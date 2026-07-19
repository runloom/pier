import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { Download, Pencil, Plus, Server, Trash2, Wifi } from "lucide-react";
import { Fragment, type JSX, useState } from "react";
import {
  describeSshTarget,
  type SshHost,
  type SshTestConnectionResult,
} from "../shared/hosts.ts";
import { openHostFormDialog } from "./host-form-dialog.tsx";
import { openImportHostsDialog } from "./import-hosts-dialog.tsx";
import { openHostTerminal } from "./open-host-terminal.tsx";
import { formatUnknownError, type Translate } from "./translate.ts";
import { useSshHostsSnapshot } from "./use-hosts-snapshot.ts";

export interface HostsSettingsPageProps {
  context: ExternalRendererPluginContext;
}

const SETTINGS_LAYOUT_CLASS =
  "flex w-full max-w-[62rem] flex-col gap-4 px-4 pb-8";

function SettingsSkeleton(): JSX.Element {
  return (
    <div className={SETTINGS_LAYOUT_CLASS}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

interface HostRowProps {
  busy: boolean;
  host: SshHost;
  onEdit: () => void;
  onOpenTerminal: () => void;
  onRemove: () => void;
  onTest: () => void;
  t: Translate;
  testing: boolean;
}

function HostRow({
  busy,
  host,
  onEdit,
  onOpenTerminal,
  onRemove,
  onTest,
  t,
  testing,
}: HostRowProps): JSX.Element {
  const testLabel = t(
    "pier.ssh.hosts.settings.testConnection",
    "Test connection"
  );
  const editLabel = t("pier.ssh.hosts.settings.edit", "Edit");
  const removeLabel = t("pier.ssh.hosts.settings.remove", "Remove");
  return (
    <Item size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle title={host.name}>{host.name}</ItemTitle>
        <ItemDescription className="font-mono text-xs">
          {describeSshTarget(host)}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          disabled={busy}
          onClick={onOpenTerminal}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("pier.ssh.hosts.settings.openTerminal", "Open terminal")}
        </Button>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-busy={testing || undefined}
                aria-label={testLabel}
                disabled={busy || testing}
                onClick={onTest}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Wifi
                  className={cn(
                    testing && "animate-pulse motion-reduce:animate-none"
                  )}
                  data-icon="inline-start"
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent data-pier-ssh-scope="">{testLabel}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={editLabel}
                disabled={busy}
                onClick={onEdit}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Pencil data-icon="inline-start" />
              </Button>
            </TooltipTrigger>
            <TooltipContent data-pier-ssh-scope="">{editLabel}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={removeLabel}
                disabled={busy}
                onClick={onRemove}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2 data-icon="inline-start" />
              </Button>
            </TooltipTrigger>
            <TooltipContent data-pier-ssh-scope="">
              {removeLabel}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </ItemActions>
    </Item>
  );
}

export function HostsSettingsPage({
  context,
}: HostsSettingsPageProps): JSX.Element {
  const { error: loadError, snapshot } = useSshHostsSnapshot(context);
  const t: Translate = (key, fallback) => context.i18n.t(key, fallback);
  const [busyHostIds, setBusyHostIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [testingHostIds, setTestingHostIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const reportError = (error: unknown): void => {
    context.dialogs
      .alert({
        body: formatUnknownError(error),
        title: t(
          "pier.ssh.hosts.settings.actionFailed",
          "SSH host action failed"
        ),
      })
      .catch(() => undefined);
  };

  const handleRemove = async (host: SshHost): Promise<void> => {
    const ok = await context.dialogs.confirm({
      body: t(
        "pier.ssh.hosts.settings.removeConfirmBody",
        "The host is removed from Pier only. Nothing changes on the remote machine or in your ssh config."
      ),
      confirmLabel: t("pier.ssh.hosts.settings.remove", "Remove"),
      intent: "destructive",
      size: "sm",
      title: t(
        "pier.ssh.hosts.settings.removeConfirmTitle",
        "Remove SSH host?"
      ),
    });
    if (!ok) {
      return;
    }
    setBusyHostIds((current) => new Set(current).add(host.id));
    try {
      await context.rpc.invoke("hosts.remove", { hostId: host.id });
    } catch (error) {
      reportError(error);
    } finally {
      setBusyHostIds((current) => {
        const next = new Set(current);
        next.delete(host.id);
        return next;
      });
    }
  };

  const handleTest = async (host: SshHost): Promise<void> => {
    setTestingHostIds((current) => new Set(current).add(host.id));
    try {
      const result = await context.rpc.invoke<SshTestConnectionResult>(
        "hosts.testConnection",
        { hostId: host.id }
      );
      if (result.ok) {
        context.notifications.success(
          t("pier.ssh.hosts.settings.testSuccess", "Connection successful")
        );
      } else {
        await context.dialogs.alert({
          body: result.detail ?? describeSshTarget(host),
          title: t(
            "pier.ssh.hosts.settings.testFailedTitle",
            "Connection failed"
          ),
        });
      }
    } catch (error) {
      reportError(error);
    } finally {
      setTestingHostIds((current) => {
        const next = new Set(current);
        next.delete(host.id);
        return next;
      });
    }
  };

  if (loadError) {
    return (
      <div className={SETTINGS_LAYOUT_CLASS}>
        <Alert variant="destructive">
          <AlertTitle>
            {t(
              "pier.ssh.hosts.settings.loadFailed",
              "Could not load SSH hosts"
            )}
          </AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!snapshot) {
    return <SettingsSkeleton />;
  }

  return (
    <div className={SETTINGS_LAYOUT_CLASS}>
      <header className="flex min-h-9 items-center justify-between gap-4">
        <h1 className="font-semibold text-xl tracking-tight">
          {t("pier.ssh.hosts.settings.title", "SSH Hosts")}
        </h1>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              openImportHostsDialog({
                context,
                onError: reportError,
                t,
              }).catch(reportError);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <Download data-icon="inline-start" />
            {t("pier.ssh.hosts.settings.import", "Import from ssh config")}
          </Button>
          <Button
            onClick={() => {
              openHostFormDialog({ context, onError: reportError, t });
            }}
            size="sm"
            type="button"
          >
            <Plus data-icon="inline-start" />
            {t("pier.ssh.hosts.settings.addHost", "Add host")}
          </Button>
        </div>
      </header>

      {snapshot.hosts.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Server />
            </EmptyMedia>
            <EmptyTitle>
              {t("pier.ssh.hosts.settings.emptyTitle", "No SSH hosts yet")}
            </EmptyTitle>
            <EmptyDescription>
              {t(
                "pier.ssh.hosts.settings.emptyDesc",
                "Add a host or import entries from your ssh config to open SSH terminals in one click."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card size="sm">
          <CardHeader>
            <CardTitle>
              {t("pier.ssh.hosts.settings.title", "SSH Hosts")}
            </CardTitle>
            <CardAction>
              <Badge variant="secondary">{snapshot.hosts.length}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            <ItemGroup className="gap-0">
              {snapshot.hosts.map((host, index) => (
                <Fragment key={host.id}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <HostRow
                    busy={busyHostIds.has(host.id)}
                    host={host}
                    onEdit={() => {
                      openHostFormDialog({
                        context,
                        initial: host,
                        onError: reportError,
                        t,
                      });
                    }}
                    onOpenTerminal={() => {
                      // 设置弹窗盖在工作区上，先关掉再开终端，否则新面板被遮挡。
                      context.app.closeSettings();
                      openHostTerminal({
                        context,
                        host,
                        onError: reportError,
                        t,
                      }).catch(() => undefined);
                    }}
                    onRemove={() => {
                      handleRemove(host).catch(() => undefined);
                    }}
                    onTest={() => {
                      handleTest(host).catch(() => undefined);
                    }}
                    t={t}
                    testing={testingHostIds.has(host.id)}
                  />
                </Fragment>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
