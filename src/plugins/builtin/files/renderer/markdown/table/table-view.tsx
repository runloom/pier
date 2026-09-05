import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pier/ui/table.tsx";
import { type ReactElement, useRef } from "react";
import type { MarkdownBlock } from "../ir.ts";
import { type MarkdownRenderContext, renderInlines } from "../ir-inlines.tsx";
import {
  cellKey,
  sourceBlockProps,
  tableAlignment,
} from "../ir-render-helpers.ts";
import { tableWidthsKey } from "./structure-key.ts";
import {
  TableColumnResizeHandle,
  useTableColumnResize,
} from "./table-resize.tsx";

/**
 * Full <table> subtree for a markdown table block. A component (not a render
 * helper) because column-resize state must live in a hook boundary per table.
 * Also owns the .md-table-wrap scroll container so the drag indicator line can
 * be positioned relative to it.
 */
export function MarkdownTableView({
  block,
  context,
}: {
  block: Extract<MarkdownBlock, { kind: "table" }>;
  context: MarkdownRenderContext;
}): ReactElement | null {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const header = block.rows[0];
  const body = block.rows.slice(1);
  const widthsKey = tableWidthsKey(block);
  const resizable =
    !context.readOnly && widthsKey !== null && Boolean(context.source);
  const resize = useTableColumnResize({
    columnCount: header ? header.cells.length : 0,
    containerRef: wrapRef,
    sourcePath: context.readOnly ? undefined : context.source?.path,
    tableRef,
    widthsKey: widthsKey ?? "",
  });
  if (!header) return null;
  return (
    <div
      {...sourceBlockProps(block.range, context, {
        className: "md-table-wrap",
      })}
      ref={wrapRef}
      {...resize.wrapProps}
    >
      <Table ref={tableRef} style={resize.tableStyle}>
        {resize.colgroup}
        <TableHeader>
          <TableRow>
            {header.cells.map((cell, index) => (
              <TableHead
                className={tableAlignment(block.align[index])}
                key={cellKey(cell)}
              >
                {renderInlines(cell.children, context)}
                {resizable ? (
                  <TableColumnResizeHandle
                    ariaLabel={context.labels.resizeColumn}
                    autoValueText={context.labels.columnWidthAuto}
                    columnIndex={index}
                    head={resize.headProps}
                    width={resize.widths?.[String(index)]}
                  />
                ) : null}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {body.map((row) => (
            <TableRow key={`${row.range.startOffset}-${row.range.endOffset}`}>
              {row.cells.map((cell, index) => (
                <TableCell
                  className={tableAlignment(block.align[index])}
                  key={cellKey(cell)}
                >
                  {renderInlines(cell.children, context)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {resize.dragLine === null ? null : (
        <div
          aria-hidden
          className="md-col-resize-line"
          style={{
            height: resize.dragLine.height,
            left: resize.dragLine.x,
            top: resize.dragLine.top,
          }}
        />
      )}
    </div>
  );
}
