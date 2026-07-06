import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "@pier/ui/empty.tsx";
import type {
  DashboardWidgetComponentProps,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type {
  AccountUsage,
  AgentAccount,
  AgentAccountsSnapshot,
} from "@shared/contracts/agent-accounts.ts";
import { AlertCircle, Check, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type PluginT, resetTextFor, UsageBar } from "./usage-meter.tsx";

interface AccountRowProps {
  account: AgentAccount;
  isActive: boolean;
  onSwitch: (accountId: string) => void;
  t: PluginT;
  usage?: AccountUsage | undefined;
}

function AccountRow({
  account,
  isActive,
  onSwitch,
  t,
  usage,
}: AccountRowProps): React.ReactElement {
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg px-3 py-2 transition-colors ${
        isActive ? "bg-accent" : "hover:bg-muted/50"
      }`}
      data-testid={`account-row-${account.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          {isActive ? (
            <Check
              className="size-3.5 shrink-0 text-primary"
              data-testid="active-indicator"
            />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 truncate font-medium text-sm">
            {account.email}
          </span>
          {account.planType && (
            <Badge
              className="rounded-full px-1.5 font-normal text-[10px] uppercase"
              variant="outline"
            >
              {account.planType}
            </Badge>
          )}
        </div>
        {!isActive && (
          <Button
            data-testid={`switch-btn-${account.id}`}
            onClick={() => onSwitch(account.id)}
            size="xs"
            variant="ghost"
          >
            {t("widget.accounts.switchTo", undefined, "Switch")}
          </Button>
        )}
      </div>
      {usage && (
        <div className="flex flex-col gap-1.5 pl-5.5">
          <UsageBar
            barId="session"
            error={usage.status === "error" ? usage.error : undefined}
            label={t("widget.accounts.session", undefined, "Session")}
            resetText={resetTextFor(t, usage.session)}
            usage={usage.session}
          />
          <UsageBar
            barId="weekly"
            error={usage.status === "error" ? usage.error : undefined}
            label={t("widget.accounts.weekly", undefined, "Weekly")}
            resetText={resetTextFor(t, usage.weekly)}
            usage={usage.weekly}
          />
        </div>
      )}
    </div>
  );
}

export function createAccountsWidget(
  context: RendererPluginContext
): React.FunctionComponent<DashboardWidgetComponentProps> {
  return function AccountsWidget(_props: DashboardWidgetComponentProps) {
    const [snapshot, setSnapshot] = useState<AgentAccountsSnapshot>(
      context.accounts.snapshot()
    );
    const [codexDetected, setCodexDetected] = useState(true);
    // "Resets in Xh Ym" 由 Date.now() 在渲染时算，但组件只在 snapshot 广播
    // （15min 轮询）时重渲——不加定时器倒计时会长时间停在旧值。每分钟 tick 强制重渲。
    const [, setNowTick] = useState(0);

    useEffect(() => {
      setSnapshot(context.accounts.snapshot());
      return context.accounts.onDidChange(setSnapshot);
    }, []);

    useEffect(() => {
      const timer = setInterval(() => setNowTick((n) => n + 1), 60_000);
      return () => clearInterval(timer);
    }, []);

    useEffect(() => {
      let cancelled = false;
      context.agents.selection().then((sel) => {
        if (!cancelled) {
          setCodexDetected(sel.detectedIds.includes("codex"));
        }
      });
      return () => {
        cancelled = true;
      };
    }, []);

    const handleSwitch = useCallback(
      async (accountId: string) => {
        const confirmEnabled =
          context.configuration.get<boolean>("pier.codex.confirmSwitch") ??
          true;
        if (confirmEnabled) {
          const target = snapshot.accounts.find((a) => a.id === accountId);
          const confirmed = await context.dialogs.confirm({
            body: context.i18n.t(
              "widget.accounts.confirmSwitch.body",
              undefined,
              "Switching accounts affects all terminals, including those outside Pier. Running Codex sessions may be disrupted."
            ),
            intent: "destructive",
            size: "sm",
            title: context.i18n.t(
              "widget.accounts.confirmSwitch.title",
              { email: target?.email ?? accountId },
              `Switch to ${target?.email ?? accountId}?`
            ),
          });
          if (!confirmed) {
            return;
          }
        }
        try {
          await context.accounts.select(accountId);
        } catch (err) {
          context.notifications.error(
            context.i18n.t(
              "widget.accounts.switchFailed",
              undefined,
              "Failed to switch account"
            ),
            { description: String(err) }
          );
        }
      },
      [snapshot.accounts]
    );

    const handleAdd = useCallback(async () => {
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
      } catch (err) {
        loading.dismiss();
        // 用户主动取消（AbortError 哨兵）：静默，不弹失败 toast
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        context.notifications.error(
          context.i18n.t(
            "widget.accounts.addFailed",
            undefined,
            "Failed to add account"
          ),
          { description: String(err) }
        );
      }
    }, []);

    const handleCancelLogin = useCallback(async () => {
      await context.accounts.cancelLogin("codex");
    }, []);

    const handleRefresh = useCallback(async () => {
      await context.accounts.refreshUsage();
    }, []);

    // 未安装态
    if (!codexDetected) {
      return (
        <Empty data-testid="state-not-installed">
          <EmptyTitle>
            {context.i18n.t(
              "widget.accounts.notInstalled",
              undefined,
              "Codex CLI not detected"
            )}
          </EmptyTitle>
          <EmptyDescription>
            {context.i18n.t(
              "widget.accounts.notInstalledHint",
              undefined,
              "Install the Codex CLI and reopen this widget."
            )}
          </EmptyDescription>
        </Empty>
      );
    }

    // 无账号态（只剩添加入口）
    if (snapshot.accounts.length === 0) {
      return (
        <div
          className="flex flex-col items-center gap-3 p-4"
          data-testid="state-empty"
        >
          {snapshot.lastLoginError && (
            <Alert data-testid="login-error-alert" variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>
                {context.i18n.t(
                  "widget.accounts.loginFailed",
                  undefined,
                  "Login failed"
                )}
              </AlertTitle>
              <AlertDescription>
                {snapshot.lastLoginError.message}
              </AlertDescription>
            </Alert>
          )}
          {snapshot.loginPending ? (
            <>
              <p className="text-muted-foreground text-sm">
                {context.i18n.t(
                  "widget.accounts.loginPending",
                  undefined,
                  "Complete login in your browser…"
                )}
              </p>
              <Button
                data-testid="cancel-login-btn"
                onClick={handleCancelLogin}
                size="sm"
                variant="ghost"
              >
                {context.i18n.t(
                  "widget.accounts.cancelLogin",
                  undefined,
                  "Cancel"
                )}
              </Button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">
                {context.i18n.t(
                  "widget.accounts.empty",
                  undefined,
                  "No Codex account configured."
                )}
              </p>
              <Button data-testid="add-btn" onClick={handleAdd} size="sm">
                {context.i18n.t(
                  "widget.accounts.add",
                  undefined,
                  "Add Account"
                )}
              </Button>
            </>
          )}
        </div>
      );
    }

    // 正常态
    return (
      <div className="flex h-full flex-col gap-0" data-testid="state-normal">
        {snapshot.lastLoginError && (
          <Alert
            className="mx-3 mt-2"
            data-testid="login-error-alert"
            variant="destructive"
          >
            <AlertCircle className="size-4" />
            <AlertTitle>
              {context.i18n.t(
                "widget.accounts.loginFailed",
                undefined,
                "Login failed"
              )}
            </AlertTitle>
            <AlertDescription>
              {snapshot.lastLoginError.message}
            </AlertDescription>
          </Alert>
        )}
        {snapshot.loginPending && (
          <div className="mx-3 mt-2 flex items-center justify-between rounded-lg bg-muted px-3 py-1.5 text-xs">
            <span>
              {context.i18n.t(
                "widget.accounts.loginPending",
                undefined,
                "Complete login in your browser…"
              )}
            </span>
            <Button
              data-testid="cancel-login-btn"
              onClick={handleCancelLogin}
              size="xs"
              variant="ghost"
            >
              {context.i18n.t(
                "widget.accounts.cancelLogin",
                undefined,
                "Cancel"
              )}
            </Button>
          </div>
        )}
        {/* 列表区自滚动，footer 钉底恒可达（卡片级动作不随内容滚出视野） */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 pt-3"
          data-scrollbar="stable"
        >
          <div className="flex flex-col gap-1">
            {snapshot.accounts.map((account) => (
              <AccountRow
                account={account}
                isActive={account.id === snapshot.activeAccountId}
                key={account.id}
                onSwitch={handleSwitch}
                t={context.i18n.t}
                usage={snapshot.usage[account.id] ?? undefined}
              />
            ))}
          </div>
          <p className="px-3 pt-2 pb-1 text-muted-foreground text-xs">
            {context.i18n.t(
              "widget.accounts.count",
              { count: snapshot.accounts.length },
              `Accounts: ${snapshot.accounts.length}`
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-border/60 border-t px-3 py-2">
          <Button
            data-testid="refresh-btn"
            onClick={handleRefresh}
            size="xs"
            variant="ghost"
          >
            <RefreshCw className="size-3" />
            {context.i18n.t("widget.accounts.refresh", undefined, "Refresh")}
          </Button>
          {snapshot.lastLoginError ? (
            <Button
              data-testid="retry-btn"
              onClick={handleAdd}
              size="xs"
              variant="destructive"
            >
              {context.i18n.t(
                "widget.accounts.retry",
                undefined,
                "Retry Login"
              )}
            </Button>
          ) : (
            <Button
              data-testid="add-more-btn"
              onClick={handleAdd}
              size="xs"
              variant="ghost"
            >
              {context.i18n.t("widget.accounts.add", undefined, "Add Account")}
            </Button>
          )}
        </div>
      </div>
    );
  };
}
