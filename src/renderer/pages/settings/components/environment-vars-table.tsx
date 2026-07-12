import { Button } from "@pier/ui/button.tsx";
import { Field, FieldGroup, FieldLabel } from "@pier/ui/field.tsx";
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
    <FieldGroup className="gap-2">
      {rows.map((row, i) => (
        <FieldGroup
          className="grid grid-cols-[160px_1fr_auto] gap-2"
          key={row.id}
        >
          <Field>
            <FieldLabel className="sr-only" htmlFor={`${row.id}-key`}>
              {t("settings.environment.envVars.keyLabel")}
            </FieldLabel>
            <Input
              className="font-mono"
              id={`${row.id}-key`}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                updateRow(i, "key", e.target.value)
              }
              placeholder="KEY"
              value={row.key}
            />
          </Field>
          <Field>
            <FieldLabel className="sr-only" htmlFor={`${row.id}-value`}>
              {t("settings.environment.envVars.valueLabel")}
            </FieldLabel>
            <Input
              className="font-mono"
              id={`${row.id}-value`}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                updateRow(i, "value", e.target.value)
              }
              placeholder="value"
              value={row.value}
            />
          </Field>
          <Button
            aria-label={t("settings.environment.envVars.remove")}
            disabled={rows.length === 1}
            onClick={() => removeRow(i)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 data-icon="inline-start" />
          </Button>
        </FieldGroup>
      ))}
      <Button
        className="w-fit"
        onClick={addRow}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus data-icon="inline-start" />
        {t("settings.environment.envVars.addVariable")}
      </Button>
    </FieldGroup>
  );
}
