import {
  Badge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "pier/canvas";
import type { ReactNode } from "react";

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text as="h2" className="text-lg font-semibold tracking-tight">
      {children}
    </Text>
  );
}

export function SubTitle({ children }: { children: ReactNode }) {
  return (
    <Text as="h3" className="text-sm font-semibold tracking-tight">
      {children}
    </Text>
  );
}

export function SectionLead({ children }: { children: ReactNode }) {
  return (
    <Text className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
      {children}
    </Text>
  );
}

export function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="grid min-w-0 gap-2 text-sm leading-relaxed">
      {items.map((item) => (
        <li className="flex min-w-0 gap-2" key={item}>
          <span aria-hidden className="text-muted-foreground">
            —
          </span>
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function badgeTone(
  label: string,
): "success" | "warning" | "outline" | "info" {
  if (label === "方案已钉" || label === "adopt" || label === "推荐方案") {
    return "success";
  }
  if (label === "待实现") {
    return "warning";
  }
  if (label === "reject") {
    return "outline";
  }
  return "info";
}

export function StatusBadge({ label }: { label: string }) {
  const text =
    label === "adopt" ? "采纳" : label === "reject" ? "否决" : label;
  return (
    <Badge size="xs" variant={badgeTone(label)}>
      {text}
    </Badge>
  );
}

export function DataTable({
  caption,
  headers,
  rows,
  monoFirst = false,
}: {
  caption: string;
  headers: string[];
  rows: ReactNode[][];
  monoFirst?: boolean;
}) {
  return (
    <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-border/70 bg-muted/10">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead
                className="min-w-28 whitespace-normal align-bottom text-xs leading-snug text-muted-foreground"
                key={header}
              >
                {header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={`${caption}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <TableCell
                  className={
                    monoFirst && cellIndex === 0
                      ? "min-w-24 max-w-56 align-top whitespace-normal break-words font-mono text-xs"
                      : "min-w-32 max-w-80 align-top whitespace-normal break-words text-xs leading-relaxed text-muted-foreground"
                  }
                  key={`${caption}-${rowIndex}-${cellIndex}`}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
