import { Button } from "@pier/ui/button.tsx";
import { Input } from "@pier/ui/input.tsx";
import { Plus, Trash2 } from "lucide-react";
import type { ChangeEvent } from "react";
import { useT } from "@/i18n/use-t.ts";

export interface EnvVarRow {
  id: string;
  key: string;
  value: string;
}

export interface EnvironmentVarsTableProps {
  onChange: (rows: EnvVarRow[]) => void;
  rows: EnvVarRow[];
}

let nextEnvRowId = 0;

export function createEnvVarRow(key = "", value = ""): EnvVarRow {
  nextEnvRowId += 1;
  return { id: `env-row-${nextEnvRowId}`, key, value };
}

export function envToRows(env: Record<string, string>): EnvVarRow[] {
  const rows = Object.entries(env).map(([key, value]) =>
    createEnvVarRow(key, value)
  );
  return rows.length > 0 ? rows : [createEnvVarRow()];
}

export function rowsToEnv(rows: EnvVarRow[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const { key, value } of rows) {
    const trimmed = key.trim();
    if (trimmed) {
      env[trimmed] = value;
    }
  }
  return env;
}

export function envRecordsEqual(
  left: Record<string, string>,
  right: Record<string, string>
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key, index) => {
    const rightKey = rightKeys[index];
    return rightKey === key && left[key] === right[rightKey];
  });
}

export function EnvironmentVarsTable({
  onChange,
  rows,
}: EnvironmentVarsTableProps) {
  const t = useT();

  function updateRow(
    index: number,
    field: "key" | "value",
    next: string
  ): void {
    onChange(
      rows.map((row, i) => (i === index ? { ...row, [field]: next } : row))
    );
  }

  function removeRow(index: number): void {
    onChange(rows.filter((_, i) => i !== index));
  }

  function addRow(): void {
    onChange([...rows, createEnvVarRow()]);
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <div className="grid grid-cols-[160px_1fr_auto] gap-2" key={row.id}>
          <Input
            className="font-mono"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateRow(i, "key", e.target.value)
            }
            placeholder="KEY"
            value={row.key}
          />
          <Input
            className="font-mono"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateRow(i, "value", e.target.value)
            }
            placeholder="value"
            value={row.value}
          />
          <Button
            aria-label={t("settings.environment.envVars.remove")}
            disabled={rows.length === 1}
            onClick={() => removeRow(i)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        className="w-fit"
        onClick={addRow}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus data-icon />
        {t("settings.environment.envVars.addVariable")}
      </Button>
    </div>
  );
}
