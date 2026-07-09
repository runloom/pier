/**
 * 设置对话框「终端 → 状态栏」管理块。
 *
 * 数据来源 = core 声明源(CORE_TERMINAL_STATUS_ITEMS)+ plugin-registry.store
 * 中已启用插件 manifest 声明的 terminalStatusItems(含当前未注册渲染的,按声明
 * 展示) × 用户覆盖镜像;同 id 时 core 优先(与右键菜单/合并层同口径)。
 * 排序交互为上移/下移按钮(首版不引入 dnd 依赖,spec §3.3);列表为外侧优先序,
 * 上移 = 向外侧。重排落库:交换后按 normalizedGroupOrders(index*10)给顺序有
 * 变化的项写 order 覆盖。
 */
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type {
  CoreTerminalStatusItemDeclaration,
  TerminalStatusBarOverridePatches,
  TerminalStatusBarPrefs,
} from "@shared/contracts/terminal-status-bar.ts";
import i18next from "i18next";
import { ArrowDown, ArrowLeftRight, ArrowUp, RotateCcw } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import { resolvePluginTerminalStatusItemDisplay } from "@/lib/plugins/display.ts";
import { CORE_TERMINAL_STATUS_ITEMS } from "@/panel-kits/terminal/core-terminal-status-items.ts";
import {
  compareOuterFirst,
  normalizedGroupOrders,
  resolveEffectiveTerminalStatusItemConfig,
} from "@/panel-kits/terminal/terminal-status-bar-merge.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";

interface StatusBarRow {
  alignment: "left" | "right";
  hasOverride: boolean;
  hidden: boolean;
  id: string;
  order: number;
  title: string;
}

function buildRows(
  plugins: readonly PluginRegistryEntry[],
  prefs: TerminalStatusBarPrefs,
  coreItems: readonly CoreTerminalStatusItemDeclaration[]
): { left: StatusBarRow[]; right: StatusBarRow[] } {
  const locale = i18next.language || "en";
  const left: StatusBarRow[] = [];
  const right: StatusBarRow[] = [];
  const seen = new Set<string>();

  const pushRow = (
    id: string,
    declaredAlignment: "left" | "right" | undefined,
    declaredOrder: number | undefined,
    title: string
  ) => {
    const config = resolveEffectiveTerminalStatusItemConfig(
      { alignment: declaredAlignment, order: declaredOrder },
      prefs.items[id]
    );
    const row: StatusBarRow = {
      alignment: config.alignment,
      hasOverride: prefs.items[id] !== undefined,
      hidden: config.hidden,
      id,
      order: config.order,
      title,
    };
    if (config.alignment === "right") {
      right.push(row);
    } else {
      left.push(row);
    }
    seen.add(id);
  };

  for (const item of coreItems) {
    pushRow(item.id, item.alignment, item.order, i18next.t(item.titleKey));
  }
  for (const entry of plugins) {
    // F12:与 merge.ts / menu.ts 同口径,用 entry.runtime.enabled(实际运行时激活态)。
    if (!entry.runtime.enabled) {
      continue;
    }
    for (const item of entry.manifest.terminalStatusItems) {
      if (seen.has(item.id)) {
        continue;
      }
      pushRow(
        item.id,
        item.alignment,
        item.order,
        resolvePluginTerminalStatusItemDisplay(entry.manifest, item, locale)
          .title
      );
    }
  }
  left.sort(compareOuterFirst);
  right.sort(compareOuterFirst);
  return { left, right };
}

/**
 * F8:交换后按 normalizedGroupOrders 给顺序有变化的项组一次批量 patch,经
 * applyOverrides 单次 IPC 原子应用(全部落盘 + 恰一次广播),取代逐项顺序
 * 调用 patchItemOverride(N 次 IPC 无原子性 —— 半途失败会留下不一致的中间态)。
 */
async function moveWithinGroup(
  rows: readonly StatusBarRow[],
  index: number,
  direction: -1 | 1
): Promise<void> {
  const target = index + direction;
  if (target < 0 || target >= rows.length) {
    return;
  }
  const ids = rows.map((row) => row.id);
  const moved = ids[index];
  const other = ids[target];
  if (moved === undefined || other === undefined) {
    return;
  }
  ids[index] = other;
  ids[target] = moved;
  const orders = normalizedGroupOrders(ids);
  const patches: TerminalStatusBarOverridePatches = {};
  for (const row of rows) {
    const nextOrder = orders[row.id];
    if (nextOrder !== undefined && nextOrder !== row.order) {
      patches[row.id] = { order: nextOrder };
    }
  }
  if (Object.keys(patches).length === 0) {
    return;
  }
  await useTerminalStatusBarPrefsStore.getState().applyOverrides(patches);
}

function StatusBarRowView({
  index,
  row,
  rows,
}: {
  index: number;
  row: StatusBarRow;
  rows: readonly StatusBarRow[];
}) {
  const t = useT();
  const patchItemOverride = useTerminalStatusBarPrefsStore(
    (s) => s.patchItemOverride
  );
  const resetItem = useTerminalStatusBarPrefsStore((s) => s.resetItem);
  // F9:store 的 patch/批量/reset 动作 IPC 失败时会 rethrow(不再悄悄吞错),
  // 调用方在这里统一兜底成 alert,让用户能感知失败而不是静默无变化。
  const reportFailure = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    showAppAlert({
      title: t("settings.statusBar.updateFailed"),
      body: message,
    });
  };
  return (
    <div
      className="flex items-center gap-2 py-1"
      data-testid={`status-bar-row-${row.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm">{row.title}</span>
          {row.hasOverride ? (
            <Badge variant="secondary">
              {t("settings.statusBar.modified")}
            </Badge>
          ) : null}
        </div>
        <div className="truncate font-mono text-muted-foreground text-xs">
          {row.id}
        </div>
      </div>
      <Switch
        aria-label={t("settings.statusBar.visible")}
        checked={!row.hidden}
        onCheckedChange={(checked) => {
          patchItemOverride(row.id, {
            hidden: checked ? null : true,
          }).catch(reportFailure);
        }}
      />
      <Button
        aria-disabled={index === 0}
        aria-label={t("settings.statusBar.moveUp")}
        onClick={() => {
          if (index === 0) {
            return;
          }
          moveWithinGroup(rows, index, -1).catch(reportFailure);
        }}
        size="icon-sm"
        title={t("settings.statusBar.moveUp")}
        type="button"
        variant="ghost"
      >
        <ArrowUp />
      </Button>
      <Button
        aria-disabled={index === rows.length - 1}
        aria-label={t("settings.statusBar.moveDown")}
        onClick={() => {
          if (index === rows.length - 1) {
            return;
          }
          moveWithinGroup(rows, index, 1).catch(reportFailure);
        }}
        size="icon-sm"
        title={t("settings.statusBar.moveDown")}
        type="button"
        variant="ghost"
      >
        <ArrowDown />
      </Button>
      <Button
        aria-label={
          row.alignment === "left"
            ? t("settings.statusBar.moveToRight")
            : t("settings.statusBar.moveToLeft")
        }
        onClick={() => {
          patchItemOverride(row.id, {
            alignment: row.alignment === "left" ? "right" : "left",
          }).catch(reportFailure);
        }}
        size="icon-sm"
        title={
          row.alignment === "left"
            ? t("settings.statusBar.moveToRight")
            : t("settings.statusBar.moveToLeft")
        }
        type="button"
        variant="ghost"
      >
        <ArrowLeftRight />
      </Button>
      <Button
        aria-disabled={!row.hasOverride}
        aria-label={t("settings.statusBar.reset")}
        onClick={() => {
          if (!row.hasOverride) {
            return;
          }
          resetItem(row.id).catch(reportFailure);
        }}
        size="icon-sm"
        title={t("settings.statusBar.reset")}
        type="button"
        variant="ghost"
      >
        <RotateCcw />
      </Button>
    </div>
  );
}

function StatusBarGroup({
  heading,
  rows,
}: {
  heading: string;
  rows: readonly StatusBarRow[];
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 first:mt-0">
      <div className="mb-1 text-muted-foreground text-xs uppercase">
        {heading}
      </div>
      {rows.map((row, index) => (
        <StatusBarRowView index={index} key={row.id} row={row} rows={rows} />
      ))}
    </div>
  );
}

export function TerminalStatusBarBlock() {
  const t = useT();
  const plugins = usePluginRegistryStore((s) => s.plugins);
  const prefs = useTerminalStatusBarPrefsStore((s) => s.prefs);
  const { left, right } = buildRows(plugins, prefs, CORE_TERMINAL_STATUS_ITEMS);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.statusBar.title")}</CardTitle>
        <CardDescription>{t("settings.statusBar.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <StatusBarGroup
          heading={t("settings.statusBar.leftGroup")}
          rows={left}
        />
        <StatusBarGroup
          heading={t("settings.statusBar.rightGroup")}
          rows={right}
        />
      </CardContent>
    </Card>
  );
}
