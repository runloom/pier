import { Badge } from "pier/canvas";

/** Local project component used by composition template. */
export function DemoChip({ label }: { label: string }) {
  return <Badge variant="outline">{label}</Badge>;
}
