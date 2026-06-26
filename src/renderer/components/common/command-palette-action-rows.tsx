import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { CommandGroup, CommandItem } from "@/components/primitives/command.tsx";
import { Kbd } from "@/components/primitives/kbd.tsx";
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
  return (
    <CommandItem
      data-disabled={action.enabled?.() === false}
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
      {shortcut ? (
        <Kbd className="ml-auto bg-transparent font-mono tracking-wider">
          {shortcut}
        </Kbd>
      ) : null}
    </CommandItem>
  );
}
