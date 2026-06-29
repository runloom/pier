import { CommandGroup, CommandItem } from "@pier/ui/command.tsx";
import { Kbd } from "@pier/ui/kbd.tsx";
import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import type { Action } from "@/lib/actions/types.ts";
import type { ActionGroup } from "@/lib/command-palette/action-search.ts";

export function SearchResultsView({
  actions,
  heading,
  keybindingLabels,
  onExecute,
}: {
  actions: readonly Action[];
  heading: string;
  keybindingLabels: ReadonlyMap<string, string>;
  onExecute: (action: Action) => Promise<void>;
}): ReactNode {
  if (actions.length === 0) {
    return null;
  }
  return (
    <CommandGroup heading={heading}>
      {actions.map((action) => (
        <ActionCommandItem
          action={action}
          key={action.id}
          keybindingLabels={keybindingLabels}
          onExecute={onExecute}
        />
      ))}
    </CommandGroup>
  );
}

export function CommandsView({
  categoryHeading,
  groups,
  keybindingLabels,
  onExecute,
}: {
  categoryHeading: (category: string) => string;
  groups: readonly ActionGroup[];
  keybindingLabels: ReadonlyMap<string, string>;
  onExecute: (action: Action) => Promise<void>;
}): ReactNode {
  return (
    <>
      {groups.map((group) => (
        <CommandGroup
          heading={categoryHeading(group.category)}
          key={group.category}
        >
          {group.actions.map((action) => (
            <ActionCommandItem
              action={action}
              key={action.id}
              keybindingLabels={keybindingLabels}
              onExecute={onExecute}
            />
          ))}
        </CommandGroup>
      ))}
    </>
  );
}

function ActionCommandItem({
  action,
  keybindingLabels,
  onExecute,
}: {
  action: Action;
  keybindingLabels: ReadonlyMap<string, string>;
  onExecute: (action: Action) => Promise<void>;
}): ReactNode {
  const Icon = action.metadata?.iconComponent ?? Settings;
  const shortcut = keybindingLabels.get(action.id);
  const disabled = action.enabled?.() === false;
  const disabledReason = disabled ? action.disabledReason?.() : null;
  return (
    <CommandItem
      data-disabled={disabled}
      disabled={disabled}
      onSelect={() => {
        onExecute(action).catch((err) => {
          console.error(
            `[command-palette] onSelect ${action.id} rejected:`,
            err
          );
        });
      }}
      value={action.id}
    >
      <Icon className="size-4 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate">{action.title()}</span>
      {disabledReason ? (
        <span className="max-w-56 shrink-0 truncate text-muted-foreground text-xs">
          {disabledReason}
        </span>
      ) : null}
      {shortcut ? (
        <Kbd className="ml-auto bg-transparent font-mono tracking-wider">
          {shortcut}
        </Kbd>
      ) : null}
    </CommandItem>
  );
}
