import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyTitle,
  formatPercent,
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
  Progress,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "pier/canvas";
import { host, useHostSnapshot } from "pier/host";
import { useState } from "react";

/**
 * 同一套投影通道的两种拼法：Codex 走紧凑 Item 行，Grok 走表。
 * 快照是 unknown，本文件本地收窄；不要做成 pier/canvas 领域组件。
 */

const CODEX_ACCOUNTS = "plugin:pier.codex/accounts";
const GROK_ACCOUNTS = "plugin:pier.grok/accounts";

type PluginId = "pier.codex" | "pier.grok";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface AccountRow {
  id: string;
  label: string;
  status: string;
  usedPercent: number | null;
}

interface AccountsView {
  accounts: AccountRow[];
  activeAccountId: string | null;
}

function quotaPercent(usage: unknown): number | null {
  if (!isRecord(usage) || !Array.isArray(usage.metrics)) {
    return null;
  }
  for (const metric of usage.metrics) {
    if (
      isRecord(metric) &&
      metric.kind === "quota" &&
      typeof metric.usedPercent === "number" &&
      Number.isFinite(metric.usedPercent)
    ) {
      return metric.usedPercent;
    }
  }
  return null;
}

function clampPercent(usedPercent: number): number {
  if (usedPercent <= 0) {
    return 0;
  }
  if (usedPercent >= 100) {
    return 100;
  }
  return usedPercent;
}

function parseAccounts(data: unknown): AccountsView | null {
  if (!isRecord(data) || !Array.isArray(data.accounts)) {
    return null;
  }
  const accounts: AccountRow[] = [];
  for (const raw of data.accounts) {
    if (!isRecord(raw) || typeof raw.id !== "string") {
      continue;
    }
    accounts.push({
      id: raw.id,
      label: typeof raw.label === "string" ? raw.label : raw.id,
      status: typeof raw.status === "string" ? raw.status : "available",
      usedPercent: quotaPercent(raw.usage),
    });
  }
  return {
    accounts,
    activeAccountId:
      typeof data.activeAccountId === "string" ? data.activeAccountId : null,
  };
}

function statusLabel(status: string): string {
  if (status === "available") {
    return "可用";
  }
  if (status === "error") {
    return "出错";
  }
  if (status === "login-pending") {
    return "登录中";
  }
  if (status === "active") {
    return "当前";
  }
  return status;
}

function invokeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function openPluginSettings(pluginId: PluginId): void {
  host
    .invoke({
      section: `plugin:${pluginId}`,
      type: "settings.open",
    })
    .catch(() => undefined);
}

function selectAccount(pluginId: PluginId, accountId: string): Promise<unknown> {
  return host.invoke({
    payload: {
      key: "accounts.select",
      payload: { accountId },
      pluginId,
    },
    type: "pluginAction.invoke",
  });
}

function refreshUsage(pluginId: PluginId): Promise<unknown> {
  return host.invoke({
    payload: { key: "accounts.refreshUsage", pluginId },
    type: "pluginAction.invoke",
  });
}

function QuotaMeter({ usedPercent }: { usedPercent: number | null }) {
  if (usedPercent === null) {
    return (
      <Text className="text-xs" tone="secondary">
        用量未就绪
      </Text>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Progress className="h-1.5" max={100} value={clampPercent(usedPercent)} />
      <Text className="tabular-nums text-xs" tone="secondary">
        {formatPercent(usedPercent / 100, "zh-CN")}
      </Text>
    </div>
  );
}

function PluginAccountCompose({
  pluginId,
  snapshotTarget,
  title,
  variant,
}: {
  pluginId: PluginId;
  snapshotTarget: typeof CODEX_ACCOUNTS | typeof GROK_ACCOUNTS;
  title: string;
  variant: "rows" | "table";
}) {
  const snapshot = useHostSnapshot(snapshotTarget);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const view = parseAccounts(snapshot.data);
  const others =
    view?.accounts.filter((row) => row.id !== view.activeAccountId) ?? [];
  const switching = pendingId !== null;

  const switchAccount = (accountId: string): void => {
    if (switching) {
      return;
    }
    setActionError(null);
    setPendingId(accountId);
    selectAccount(pluginId, accountId)
      .catch((error: unknown) => {
        setActionError(invokeMessage(error));
      })
      .finally(() => {
        setPendingId((current) => (current === accountId ? null : current));
      });
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm">{title}</CardTitle>
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button
              onClick={() => {
                setActionError(null);
                refreshUsage(pluginId).catch((error: unknown) => {
                  setActionError(invokeMessage(error));
                });
              }}
              variant="ghost"
            >
              刷新用量
            </Button>
            {variant === "rows" && others.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button disabled={switching} variant="ghost">
                    切换账号
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto min-w-48">
                  {others.map((row) => (
                    <DropdownMenuItem
                      key={row.id}
                      onSelect={() => {
                        switchAccount(row.id);
                      }}
                    >
                      {row.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button
              onClick={() => {
                openPluginSettings(pluginId);
              }}
              variant="ghost"
            >
              设置
            </Button>
          </div>
        </div>
        <CardDescription>
          {variant === "rows"
            ? "紧凑行：Item + Progress + 菜单切换。添加与登录只走设置。"
            : "表：每一行一个账号。同一投影，另一种拼法。"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {actionError ? (
          <Alert variant="destructive">
            <AlertTitle>操作未完成</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}
        {snapshot.status === "loading" ? (
          <Skeleton className="h-24 w-full" />
        ) : snapshot.status === "error" ? (
          <Alert>
            <AlertTitle>无法读取投影</AlertTitle>
            <AlertDescription>
              {snapshot.error ?? "请确认插件已安装并声明了 accounts 投影。"}
            </AlertDescription>
          </Alert>
        ) : view === null || view.accounts.length === 0 ? (
          <Empty className="border p-4">
            <EmptyTitle className="text-sm">还没有账号</EmptyTitle>
            <EmptyDescription className="text-xs">
              在设置里添加或登录后，这里会列出投影数据。
            </EmptyDescription>
          </Empty>
        ) : variant === "rows" ? (
          view.accounts.map((row) => {
            const active = row.id === view.activeAccountId;
            return (
              <Item key={row.id} size="sm" variant="outline">
                <ItemContent>
                  <ItemTitle className="truncate">{row.label}</ItemTitle>
                  <QuotaMeter usedPercent={row.usedPercent} />
                </ItemContent>
                <ItemActions>
                  {active ? <Badge variant="outline">当前</Badge> : null}
                </ItemActions>
              </Item>
            );
          })
        ) : (
          <Table>
            <TableCaption className="sr-only">{title} 账号</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>账号</TableHead>
                <TableHead>用量</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.accounts.map((row) => {
                const active = row.id === view.activeAccountId;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-40 truncate">
                      {row.label}
                    </TableCell>
                    <TableCell>
                      <QuotaMeter usedPercent={row.usedPercent} />
                    </TableCell>
                    <TableCell>
                      {active ? (
                        <Badge variant="outline">当前</Badge>
                      ) : (
                        <Text className="text-xs" tone="secondary">
                          {statusLabel(row.status)}
                        </Text>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {active ? null : (
                        <Button
                          disabled={switching}
                          onClick={() => {
                            switchAccount(row.id);
                          }}
                          variant="ghost"
                        >
                          切换
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function CodexAccountRows() {
  return (
    <PluginAccountCompose
      pluginId="pier.codex"
      snapshotTarget={CODEX_ACCOUNTS}
      title="Codex 账号（紧凑行）"
      variant="rows"
    />
  );
}

export function GrokAccountTable() {
  return (
    <PluginAccountCompose
      pluginId="pier.grok"
      snapshotTarget={GROK_ACCOUNTS}
      title="Grok 账号（表）"
      variant="table"
    />
  );
}
