import { Button } from "@pier/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pier/ui/tooltip.tsx";
import {
  ChevronDown,
  Plus,
  Redo2,
  Settings2,
  Trash2,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import type { FilesTranslate } from "../../i18n.ts";
import { useCsvHeaderState } from "./header-state.ts";
import type { CsvDelimiter } from "./parser.ts";

function isCsvDelimiter(value: string): value is CsvDelimiter {
  return value === "," || value === "\t" || value === ";" || value === "|";
}

function CsvHeaderIconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** CSV editor controls rendered in the Files panel top chrome. */
export function CsvHeaderActions({
  panelKey,
  t,
}: {
  panelKey: string;
  t: FilesTranslate;
}): React.JSX.Element | null {
  const entry = useCsvHeaderState((state) => state.entries[panelKey]);
  if (!entry) {
    return null;
  }
  const summary =
    t("filePanel.csv.summary", "Rows {{rows}} · Columns {{columns}}", {
      columns: entry.columnCount,
      rows: entry.rowCount,
    }) ?? `Rows ${entry.rowCount} · Columns ${entry.columnCount}`;
  return (
    <>
      {entry.previewOnly ? (
        <span className="text-muted-foreground text-xs">
          {t("filePanel.csv.previewOnly", "Preview only")}
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("filePanel.csv.insert", "Insert")}
            disabled={!entry.editable}
            size="xs"
            type="button"
            variant="ghost"
          >
            <Plus data-icon="inline-start" />
            {t("filePanel.csv.insert", "Insert")}
            <ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>
            {t("filePanel.csv.insert", "Insert")}
          </DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={!entry.hasActiveCell}
              onSelect={entry.insertRowAbove}
            >
              {t("filePanel.csv.insertRowAbove", "Insert row above")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!entry.hasActiveCell}
              onSelect={entry.insertRowBelow}
            >
              {t("filePanel.csv.insertRowBelow", "Insert row below")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!entry.hasActiveCell}
              onSelect={entry.insertColumnLeft}
            >
              {t("filePanel.csv.insertColumnLeft", "Insert column left")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!entry.hasActiveCell}
              onSelect={entry.insertColumnRight}
            >
              {t("filePanel.csv.insertColumnRight", "Insert column right")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={!(entry.editable && entry.hasActiveCell)}
              onSelect={entry.deleteActiveRow}
            >
              <Trash2 data-icon="inline-start" />
              {t("filePanel.csv.deleteRow", "Delete row")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!(entry.editable && entry.hasActiveCell)}
              onSelect={entry.deleteActiveColumn}
            >
              <Trash2 data-icon="inline-start" />
              {t("filePanel.csv.deleteColumn", "Delete column")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <CsvHeaderIconButton
        disabled={!entry.canUndo}
        label={t("filePanel.csv.undo", "Undo")}
        onClick={entry.undo}
      >
        <Undo2 data-icon="inline-start" />
      </CsvHeaderIconButton>
      <CsvHeaderIconButton
        disabled={!entry.canRedo}
        label={t("filePanel.csv.redo", "Redo")}
        onClick={entry.redo}
      >
        <Redo2 data-icon="inline-start" />
      </CsvHeaderIconButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("filePanel.csv.tableSettings", "Table settings")}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Settings2 data-icon="inline-start" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuLabel>{summary}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>
            {t("filePanel.csv.delimiter", "Delimiter")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            onValueChange={(next) => {
              if (next === "auto" || isCsvDelimiter(next)) {
                entry.setDelimiter(next);
              }
            }}
            value={entry.delimiter}
          >
            <DropdownMenuRadioItem value="auto">
              {t("filePanel.csv.delimiterAuto", "Auto-detect")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value=",">
              {t("filePanel.csv.delimiterComma", "Comma")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value={String.fromCharCode(9)}>
              {t("filePanel.csv.delimiterTab", "Tab")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value=";">
              {t("filePanel.csv.delimiterSemicolon", "Semicolon")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="|">
              {t("filePanel.csv.delimiterPipe", "Pipe")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={entry.header}
            onCheckedChange={(checked) => entry.setHeader(checked === true)}
          >
            {t("filePanel.csv.firstRowHeader", "First row is header")}
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
