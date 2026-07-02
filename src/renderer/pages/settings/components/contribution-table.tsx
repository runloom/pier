import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pier/ui/table.tsx";
import type { ReactNode } from "react";

export function ContributionTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {headers.map((header) => (
            <TableHead
              className="h-7 px-2 font-medium text-muted-foreground text-xs"
              key={header}
            >
              {header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((cells, rowIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows 是每次渲染重建的静态展示数据，行序即身份；硬接口 ReactNode[][] 无稳定 id 可用
          <TableRow className="hover:bg-transparent" key={rowIndex}>
            {headers.map((header, columnIndex) => (
              <TableCell
                className="whitespace-normal px-2 py-1.5 align-top"
                key={header}
              >
                {cells[columnIndex]}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
