import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { type AgentKind, agentKindSchema } from "@shared/contracts/agent.ts";

export function AgentSelect({
  agentIds,
  disabled,
  emptyLabel,
  id,
  onValueChange,
  placeholder,
  value,
}: {
  agentIds: readonly AgentKind[];
  disabled?: boolean;
  emptyLabel: string;
  id: string;
  onValueChange: (value: AgentKind) => void;
  placeholder: string;
  value: AgentKind | "";
}) {
  return (
    <Select
      disabled={disabled || agentIds.length === 0}
      onValueChange={(next) => {
        const parsed = agentKindSchema.safeParse(next);
        if (parsed.success) {
          onValueChange(parsed.data);
        }
      }}
      value={value}
    >
      <SelectTrigger className="w-full" id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {agentIds.length > 0 ? (
            agentIds.map((agentId) => {
              const entry = getAgentCatalogEntry(agentId);
              return (
                <SelectItem key={agentId} value={agentId}>
                  {entry?.label ?? agentId}
                </SelectItem>
              );
            })
          ) : (
            <SelectItem disabled value="__empty">
              {emptyLabel}
            </SelectItem>
          )}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
