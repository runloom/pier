/**
 * 标题栏消息中心入口：铃铛 + 未读徽标 + Popover 全量列表。
 * mac（TitleBar）与非 mac（AgentIndexChromeBar）右簇共用本组件。
 * 轻量：无独立 panel、无筛选/搜索；列表滚动触底加载更多。
 * 组合边界：Button + Badge + Popover 原语 + Item 列表 + Empty，禁手写骨架/徽标。
 */
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { ItemGroup } from "@pier/ui/item.tsx";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@pier/ui/popover.tsx";
import { Separator } from "@pier/ui/separator.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import { Bell, BellOff, Inbox } from "lucide-react";
import {
  type ReactNode,
  type UIEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { NotificationCard } from "@/components/common/notifications/card.tsx";
import { useT } from "@/i18n/use-t.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { useActionKeybindingLabel } from "@/lib/keybindings/use-action-label.ts";
import {
  consumeWebOverlayOutsideDismiss,
  markWebOverlayOutsideDismissIfNeeded,
  restoreTerminalFocusAfterWebOverlayDismiss,
} from "@/lib/workspace/restore-terminal-focus-after-web-overlay-dismiss.ts";
import { useAppContentDialogStore } from "@/stores/app-content-dialog.store.ts";
import { showAppAlert, useAppDialogStore } from "@/stores/app-dialog.store.ts";
import {
  attentionUnreadCount,
  useNotificationCenterStore,
} from "@/stores/notification-center.store.ts";
import { useNotificationCenterPopoverStore } from "@/stores/notification-center-popover.store.ts";
import { useNotificationCenterPrefsStore } from "@/stores/notification-center-prefs.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing-slice.ts";

/** 首屏与每次触底追加的条数。 */
const PAGE_SIZE = 20;
/** 距底部多少 px 内触发加载更多。 */
const LOAD_MORE_THRESHOLD_PX = 48;
const NOTIFICATION_CENTER_OVERLAY_ID = "overlay:notification-center";

function NotificationCenterPopoverBody({
  onClose,
}: {
  onClose: () => void;
}): ReactNode {
  const t = useT();
  const items = useNotificationCenterStore((s) => s.items);
  const dndEnabled = useNotificationCenterStore((s) => s.dndEnabled);
  const unreadCount = useNotificationCenterStore((s) => s.unreadCount);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState(false);

  // 列表变短时（删除/过期）夹住 visibleCount，避免空白滚动区
  useEffect(() => {
    setVisibleCount((count) => {
      if (items.length === 0) {
        return PAGE_SIZE;
      }
      return Math.min(Math.max(count, PAGE_SIZE), items.length);
    });
  }, [items.length]);

  const visible = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  const onListScroll = useCallback(
    (event: UIEvent<HTMLUListElement>) => {
      if (!hasMore) {
        return;
      }
      const el = event.currentTarget;
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (remaining > LOAD_MORE_THRESHOLD_PX) {
        return;
      }
      setVisibleCount((count) => Math.min(count + PAGE_SIZE, items.length));
    },
    [hasMore, items.length]
  );

  const runHeaderAction = useCallback(
    async (action: () => Promise<void>) => {
      if (busy) {
        return;
      }
      setBusy(true);
      try {
        await action();
        onClose();
      } catch (error) {
        await showAppAlert({
          body: error instanceof Error ? error.message : String(error),
          title: t("notificationsCenter.actionFailed"),
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, onClose, t]
  );

  return (
    <>
      <div className="flex items-center gap-0.5 p-3 pb-2">
        <PopoverHeader className="flex-1">
          <PopoverTitle className="text-sm">
            {t("notificationsCenter.header.title")}
          </PopoverTitle>
        </PopoverHeader>
        {unreadCount > 0 ? (
          <Badge size="xs" variant="neutral">
            {t("notificationsCenter.header.unread", { count: unreadCount })}
          </Badge>
        ) : null}
        {unreadCount > 0 ? (
          <Button
            disabled={busy}
            onClick={() => {
              runHeaderAction(() =>
                window.pier.notificationCenter.markAllRead()
              ).catch(() => undefined);
            }}
            size="xs"
            type="button"
            variant="ghost"
          >
            {t("notificationsCenter.header.markAllRead")}
          </Button>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t(
                dndEnabled
                  ? "notificationsCenter.dnd.off"
                  : "notificationsCenter.dnd.on"
              )}
              disabled={busy}
              onClick={() => {
                runHeaderAction(() =>
                  window.pier.notificationCenter.setDnd(!dndEnabled)
                ).catch(() => undefined);
              }}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              {dndEnabled ? <BellOff data-icon /> : <Bell data-icon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t(
              dndEnabled
                ? "notificationsCenter.dnd.off"
                : "notificationsCenter.dnd.on"
            )}
          </TooltipContent>
        </Tooltip>
      </div>
      <Separator className="opacity-50" />
      {visible.length === 0 ? (
        <Empty className="gap-2 px-4 py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>{t("notificationsCenter.empty")}</EmptyTitle>
            <EmptyDescription>
              {t("notificationsCenter.emptyDetail")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup
          className="max-h-[min(28rem,70vh)] overflow-y-auto p-1 data-[size=xs]:gap-1"
          data-scrollbar="none"
          data-size="xs"
          data-testid="notification-center-list"
          onScroll={onListScroll}
        >
          {visible.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              onActionRun={onClose}
            />
          ))}
          {hasMore ? (
            <p
              className="px-2 py-1.5 text-center text-muted-foreground text-xs"
              data-testid="notification-center-load-more"
            >
              {t("notificationsCenter.loadMore")}
            </p>
          ) : null}
        </ItemGroup>
      )}
    </>
  );
}

export function NotificationCenterControl(): ReactNode {
  const t = useT();
  const items = useNotificationCenterStore((s) => s.items);
  const dndEnabled = useNotificationCenterStore((s) => s.dndEnabled);
  const showUnreadBadge = useNotificationCenterPrefsStore(
    (s) => s.prefs.showUnreadBadge
  );
  const open = useNotificationCenterPopoverStore((s) => s.open);
  const setOpen = useNotificationCenterPopoverStore((s) => s.setOpen);
  const openShortcut = useActionKeybindingLabel("pier.notifications.open");
  const attentionCount = attentionUnreadCount(items);
  const badgeVisible = showUnreadBadge && attentionCount > 0;

  useEffect(() => {
    if (!open) {
      return;
    }
    // Popover 非 modal，Radix DismissibleLayer 靠 document pointerdown 侦测外部点击。
    // 终端是原生 NSView，点击默认被 native 消费，web 收不到 → 弹层不会关。
    // 挂全屏 web overlay rect，打开期间所有点击（含落在终端画布上的）都路由到 web，
    // outside-pointerdown 才能正常触发（见 add-panel-action.tsx 同款模式）。
    const releaseOverlayRoute = registerTerminalFullscreenWebOverlay(
      NOTIFICATION_CENTER_OVERLAY_ID
    );
    // popover 生命周期内键盘钉在 web：全局快捷键（命令面板/设置）与 Escape 关闭
    // 保持可用。刻意不 pushBlockingScope（参照设置页）——不吞全局快捷键。
    const releaseWebFocus = requestTerminalWebFocus("notification-center");
    // @pier/ui Dialog 的 deferred-open 把 DOM 中仍存在的 popover-content 视为
    // 打开阻塞（schedule-after-overlay）：不收起则 Dialog 等 1s 后放弃挂载，
    // 命令面板/设置快捷键看似失效。任何 Dialog 打开信号出现时立即收起。
    const unsubs = [
      useCommandPaletteController.subscribe((state) => {
        if (state.open) {
          setOpen(false);
        }
      }),
      useSettingsDialogStore.subscribe((state) => {
        if (state.isOpen) {
          setOpen(false);
        }
      }),
      useAppDialogStore.subscribe((state) => {
        if (state.current) {
          setOpen(false);
        }
      }),
      useAppContentDialogStore.subscribe((state) => {
        if (state.stack.length > 0) {
          setOpen(false);
        }
      }),
    ];
    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
      releaseOverlayRoute.dispose();
      releaseWebFocus();
      // 仅终端向 outside 关闭后补聚焦；Dialog/Esc/trigger 不 mark。
      if (consumeWebOverlayOutsideDismiss(NOTIFICATION_CENTER_OVERLAY_ID)) {
        restoreTerminalFocusAfterWebOverlayDismiss();
      }
    };
  }, [open, setOpen]);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              aria-label={
                attentionCount > 0
                  ? t("notificationsCenter.bell.aria", {
                      count: attentionCount,
                    })
                  : t("notificationsCenter.bell.ariaEmpty")
              }
              className="app-no-drag relative"
              data-testid="notification-center-bell"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              {dndEnabled ? <BellOff data-icon /> : <Bell data-icon />}
              {badgeVisible ? (
                <Badge
                  className="absolute -top-1 -right-1 px-1 tabular-nums"
                  data-slot="notification-unread-badge"
                  size="xs"
                >
                  {attentionCount > 99 ? "99+" : attentionCount}
                </Badge>
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {t("notificationsCenter.header.title")}
          {openShortcut ? (
            <span className="text-background/70 tracking-wide">
              {openShortcut}
            </span>
          ) : null}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        className="w-96 gap-0 p-0"
        onPointerDownOutside={(event) => {
          // 仅终端向 outside 才 mark；trigger / 其它 web 控件不补终端聚焦。
          const original = event.detail.originalEvent;
          markWebOverlayOutsideDismissIfNeeded(
            NOTIFICATION_CENTER_OVERLAY_ID,
            original.target
          );
        }}
      >
        <NotificationCenterPopoverBody
          onClose={() => {
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
