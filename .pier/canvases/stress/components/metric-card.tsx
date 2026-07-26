import { Card, CardContent, CardHeader, CardTitle, Text } from "pier/canvas";

/** Local presentational card — relative import hop 1. */
export function MetricCard(props: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{props.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <Text style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {props.value}
        </Text>
        {props.hint ? (
          <Text tone="secondary" style={{ marginTop: 4 }}>
            {props.hint}
          </Text>
        ) : null}
      </CardContent>
    </Card>
  );
}
