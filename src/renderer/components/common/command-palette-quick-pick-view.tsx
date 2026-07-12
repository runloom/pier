/**
 * quick-pick 模式的列表渲染: 分组/扁平两种形态 + 默认行。
 * 状态与事件路由仍在 command-palette.tsx, 这里是纯展示层。
 */

import { Badge } from "@pier/ui/badge.tsx";
import { CommandGroup, CommandItem } from "@pier/ui/command.tsx";
import type { ReactNode } from "react";
import { quickPickResults } from "@/lib/command-palette/quick-pick-search.ts";
import type { QuickPick, QuickPickItem } from "@/lib/command-palette/types.ts";

export function quickPickItems(quickPick: QuickPick): readonly QuickPickItem[] {
  if (quickPick.sections && quickPick.sections.length > 0) {
    return quickPick.sections.flatMap((section) => section.items);
  }
  return quickPick.items ?? [];
}

export function isQuickPickItemSelectable(
  quickPick: QuickPick,
  item: QuickPickItem
): boolean {
  return quickPick.loading !== true && item.disabled !== true;
}

/**
 * quick-pick 默认行, 与 GitBranchQuickPickRow 同一套视觉语言:
 * 可选图标 + 标题行 (label + badges) + 副标题行 (detail) + 右侧次要信息
 * (description)。整行 items-center, 让 CommandItem 尾部的对勾垂直居中。
 */
function QuickPickDefaultRow({ item }: { item: QuickPickItem }): ReactNode {
  const Icon = item.icon;
  const destructive = item.variant === "destructive";
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      {Icon ? (
        <Icon
          aria-hidden="true"
          className={
            destructive
              ? "size-4 shrink-0 text-destructive"
              : "size-4 shrink-0 text-muted-foreground"
          }
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={
              destructive
                ? "min-w-0 truncate font-medium text-destructive text-sm/tight"
                : "min-w-0 truncate font-medium text-sm/tight"
            }
          >
            {item.label}
          </span>
          {item.badges?.map((badge) => (
            <Badge
              key={`${item.id}:${badge.label}`}
              variant={badge.variant ?? "secondary"}
            >
              {badge.label}
            </Badge>
          ))}
        </span>
        {item.detail ? (
          <span className="truncate text-muted-foreground text-xs/tight">
            {item.detail}
          </span>
        ) : null}
      </span>
      {item.description ? (
        <span className="min-w-0 max-w-[45%] shrink truncate text-right text-muted-foreground text-xs/tight">
          {item.description}
        </span>
      ) : null}
    </span>
  );
}

export function QuickPickView({
  quickPick,
  onAccept,
  query,
}: {
  quickPick: QuickPick;
  onAccept: (item: QuickPickItem) => Promise<void>;
  query: string;
}): ReactNode {
  const renderItem = (item: QuickPickItem) => {
    const disabled = !isQuickPickItemSelectable(quickPick, item);
    const content = quickPick.renderItem ? (
      quickPick.renderItem(item)
    ) : (
      <QuickPickDefaultRow item={item} />
    );
    return (
      <CommandItem
        aria-current={item.checked === true ? "true" : undefined}
        className="items-center gap-2"
        data-checked={item.checked === true}
        data-disabled={disabled}
        disabled={disabled}
        key={item.id}
        onSelect={() => {
          if (disabled) {
            return;
          }
          onAccept(item).catch((err) => {
            console.error(
              `[command-palette] quick-pick onAccept ${item.id} rejected:`,
              err
            );
          });
        }}
        value={item.id}
      >
        {content}
      </CommandItem>
    );
  };

  return (
    <div className="mt-2">
      {quickPick.sections && quickPick.sections.length > 0
        ? quickPick.sections.map((section) => {
            const items =
              quickPick.loading === true
                ? section.items
                : quickPickResults(section.items, query, section.heading);
            // shouldFilter={false} 下 cmdk 不感知手动过滤, 不会自动藏空组,
            // 过滤后无匹配的分组必须在这里跳过, 否则空态下残留组标题。
            if (items.length === 0) {
              return null;
            }
            return (
              <CommandGroup heading={section.heading} key={section.id}>
                {items.map(renderItem)}
              </CommandGroup>
            );
          })
        : (quickPick.loading === true
            ? (quickPick.items ?? [])
            : quickPickResults(quickPick.items ?? [], query)
          ).map(renderItem)}
    </div>
  );
}
