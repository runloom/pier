import { Badge } from "pier/canvas";

export function Owner({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function Rule({ label, text }: { label: string; text: string }) {
  return (
    <div className="cc-rule">
      <Badge variant={label === "禁止" ? "warning" : "success"}>{label}</Badge>
      <span>{text}</span>
    </div>
  );
}
