import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "pier/canvas";
import { formatUsd, type ProposalLine } from "../lib/proposal-math.ts";

/** Table of computed lines — proves non-component modules are bundled. */
export function LineTable({ lines }: { lines: ProposalLine[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Line</TableHead>
          <TableHead style={{ textAlign: "right" }}>Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.id}>
            <TableCell>
              <Text>{line.label}</Text>
            </TableCell>
            <TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {formatUsd(line.amount)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
