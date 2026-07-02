/**
 * 设置对话框「终端 → 状态栏」管理块。
 *
 * 数据来源 = plugin-registry.store 中已启用插件 manifest 声明的
 * terminalStatusItems(含当前未注册渲染的,按声明展示) × 用户覆盖镜像。
 * 排序交互为上移/下移按钮(首版不引入 dnd 依赖,spec §3.3);列表为外侧优先序,
 * 上移 = 向外侧。重排落库:交换后按 normalizedGroupOrders(index*10)给顺序有
 * 变化的项写 order 覆盖。
 */
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent } from "@pier/ui/card.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { TerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";
import i18next from "i18next";
import { ArrowDown, ArrowLeftRight, ArrowUp, RotateCcw } from "lucide-react";
import { useT } from "@/i18n/use-t.ts";
import { resolvePluginTerminalStatusItemDisplay } from "@/lib/plugins/display.ts";
import {
  compareOuterFirst,
  normalizedGroupOrders,
  resolveEffectiveTerminalStatusItemConfig,
} from "@/panel-kits/terminal/terminal-status-bar-merge.ts";
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
  prefs: TerminalStatusBarPrefs
): { left: StatusBarRow[]; right: StatusBarRow[] } {
  const locale = i18next.language || "en";
  const left: StatusBarRow[] = [];
  const right: StatusBarRow[] = [];
  for (const entry of plugins) {
    if (!entry.enabled) {
      continue;
    }
    for (const item of entry.manifest.terminalStatusItems) {
      const config = resolveEffectiveTerminalStatusItemConfig(
        item,
        prefs.items[item.id]
      );
      const row: StatusBarRow = {
        alignment: config.alignment,
        hasOverride: prefs.items[item.id] !== undefined,
        hidden: config.hidden,
        id: item.id,
        order: config.order,
        title: resolvePluginTerminalStatusItemDisplay(
          entry.manifest,
          item,
          locale
        ).title,
      };
      if (config.alignment === "right") {
        right.push(row);
      } else {
        left.push(row);
      }
    }
  }
  left.sort(compareOuterFirst);
  right.sort(compareOuterFirst);
  return { left, right };
}

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
  const patch = useTerminalStatusBarPrefsStore.getState().patchItemOverride;
  for (const row of rows) {
    const nextOrder = orders[row.id];
    if (nextOrder !== undefined && nextOrder !== row.order) {
      await patch(row.id, { order: nextOrder });
    }
  }
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
  const swallow = (err: unknown) => {
    console.error("[status-bar-settings] update failed:", err);
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
          }).catch(swallow);
        }}
      />
      <Button
        aria-label={t("settings.statusBar.moveUp")}
        disabled={index === 0}
        onClick={() => {
          moveWithinGroup(rows, index, -1).catch(swallow);
        }}
        size="icon-sm"
        title={t("settings.statusBar.moveUp")}
        type="button"
        variant="ghost"
      >
        <ArrowUp />
      </Button>
      <Button
        aria-label={t("settings.statusBar.moveDown")}
        disabled={index === rows.length - 1}
        onClick={() => {
          moveWithinGroup(rows, index, 1).catch(swallow);
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
          }).catch(swallow);
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
        aria-label={t("settings.statusBar.reset")}
        disabled={!row.hasOverride}
        onClick={() => {
          resetItem(row.id).catch(swallow);
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
  const { left, right } = buildRows(plugins, prefs);
  return (
    <>
      <h2 className="mt-6 mb-2 text-base">{t("settings.statusBar.title")}</h2>
      <Card>
        <CardContent>
          <p className="mb-2 text-muted-foreground text-xs">
            {t("settings.statusBar.description")}
          </p>
          {left.length + right.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("settings.statusBar.empty")}
            </p>
          ) : (
            <>
              <StatusBarGroup
                heading={t("settings.statusBar.leftGroup")}
                rows={left}
              />
              <StatusBarGroup
                heading={t("settings.statusBar.rightGroup")}
                rows={right}
              />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
