import type { ReactNode } from "react";
import {
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "pier/canvas";

export function DocSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <Stack gap={6}>
      <Text className="text-xs" tone="secondary">
        {title}
      </Text>
      {children}
    </Stack>
  );
}

export function DocCode({ children }: { children: string }) {
  return (
    <Text className="block whitespace-pre-wrap font-mono text-xs leading-relaxed">
      {children}
    </Text>
  );
}

export function FieldTable({
  rows,
}: {
  rows: readonly { name: string; type: string; description?: string }[];
}) {
  const showDescription = rows.some((row) => row.description);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>类型</TableHead>
          {showDescription ? <TableHead>说明</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${row.name}:${row.type}:${index}`}>
            <TableCell className="font-mono text-xs">{row.name}</TableCell>
            <TableCell className="whitespace-normal font-mono text-muted-foreground text-xs">
              {row.type}
            </TableCell>
            {showDescription ? (
              <TableCell className="whitespace-normal text-xs">
                {row.description}
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
