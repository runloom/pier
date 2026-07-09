import { Button } from "@pier/ui/button.tsx";
import { Input } from "@pier/ui/input.tsx";
import { Plus, Trash2 } from "lucide-react";
import type { ChangeEvent } from "react";
import { useT } from "@/i18n/use-t.ts";

export interface CopyPatternRow {
  id: string;
  pattern: string;
}

export interface EnvironmentCopyPatternsTableProps {
  onChange: (rows: CopyPatternRow[]) => void;
  rows: CopyPatternRow[];
}

let nextRowId = 0;

export function createCopyPatternRow(pattern = ""): CopyPatternRow {
  nextRowId += 1;
  return { id: `copy-pattern-row-${nextRowId}`, pattern };
}

export function patternsToRows(patterns: readonly string[]): CopyPatternRow[] {
  const rows = patterns.map((pattern) => createCopyPatternRow(pattern));
  return rows.length > 0 ? rows : [createCopyPatternRow()];
}

export function rowsToPatterns(rows: readonly CopyPatternRow[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { pattern } of rows) {
    const trimmed = pattern.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

export function patternListsEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export function EnvironmentCopyPatternsTable({
  onChange,
  rows,
}: EnvironmentCopyPatternsTableProps) {
  const t = useT();

  function updateRow(index: number, next: string): void {
    onChange(
      rows.map((row, i) => (i === index ? { ...row, pattern: next } : row))
    );
  }

  function removeRow(index: number): void {
    onChange(rows.filter((_, i) => i !== index));
  }

  function addRow(): void {
    onChange([...rows, createCopyPatternRow()]);
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <div className="grid grid-cols-[1fr_auto] gap-2" key={row.id}>
          <Input
            className="font-mono"
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              updateRow(i, e.target.value)
            }
            placeholder={t("settings.environment.copyPatterns.placeholder")}
            value={row.pattern}
          />
          <Button
            aria-label={t("settings.environment.copyPatterns.remove")}
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
        {t("settings.environment.copyPatterns.addPattern")}
      </Button>
    </div>
  );
}
