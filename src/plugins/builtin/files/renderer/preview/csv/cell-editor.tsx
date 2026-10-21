import { Input } from "@pier/ui/input.tsx";
import { Textarea } from "@pier/ui/textarea.tsx";
import { cn } from "@pier/ui/utils.ts";
import {
  type JSX,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RenderEditCellProps } from "react-data-grid";
import type { CsvGridRow } from "./model.ts";

/**
 * RDG's outside-click commit uses `activePosition.row`. Keep that row in sync
 * on every keystroke so a click into another cell cannot commit a stale draft.
 */
export function CsvCellEditor(
  props: RenderEditCellProps<CsvGridRow>
): JSX.Element {
  const columnKey = String(props.column.key);
  const originalValueRef = useRef(String(props.row[columnKey] ?? ""));
  const [value, setValue] = useState(originalValueRef.current);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const committedRef = useRef(false);

  useLayoutEffect(() => {
    const element = originalValueRef.current.includes("\n")
      ? textareaRef.current
      : inputRef.current;
    element?.focus();
    element?.select();
  }, []);

  const update = useCallback(
    (next: string) => {
      setValue(next);
      props.onRowChange({ ...props.row, [columnKey]: next }, false);
    },
    [columnKey, props]
  );

  const commit = useCallback(() => {
    if (committedRef.current) {
      return;
    }
    committedRef.current = true;
    if (value === originalValueRef.current) {
      props.onClose();
      return;
    }
    props.onRowChange({ ...props.row, [columnKey]: value }, true);
  }, [columnKey, props, value]);

  const cancel = useCallback(() => {
    if (committedRef.current) {
      return;
    }
    committedRef.current = true;
    props.onClose();
  }, [props]);

  const className =
    "absolute inset-0 z-20 h-7 min-h-7 rounded-none border-0 bg-background px-2 py-0.5 text-xs text-foreground shadow-none outline-none focus-visible:border-0 focus-visible:ring-1 focus-visible:ring-ring/40 md:text-xs";
  if (originalValueRef.current.includes("\n")) {
    return (
      <Textarea
        className={cn(className, "resize-none")}
        onBlur={commit}
        onChange={(event) => update(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            commit();
            return;
          }
          if (event.key === "Enter") {
            // Plain Enter inserts a line break; RDG must not close the editor.
            event.stopPropagation();
          }
        }}
        ref={textareaRef}
        rows={Math.min(6, Math.max(2, value.split("\n").length))}
        value={value}
      />
    );
  }
  return (
    <Input
      className={className}
      onBlur={commit}
      onChange={(event) => update(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          commit();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
      ref={inputRef}
      value={value}
    />
  );
}
