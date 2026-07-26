import {
  Button,
  Label,
  Row,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Switch,
  Text,
} from "pier/canvas";
import { PLAN_OPTIONS, type PlanId } from "../lib/proposal-math.ts";

/** Form controls — multi-hop import from canvas → form → math/types. */
export function ProposalForm(props: {
  planId: PlanId;
  seats: number;
  includeSupport: boolean;
  onPlanChange: (id: PlanId) => void;
  onSeatsChange: (seats: number) => void;
  onSupportChange: (value: boolean) => void;
  onReset: () => void;
}) {
  return (
    <Stack gap={14}>
      <Stack gap={6}>
        <Label htmlFor="proposal-plan">Plan</Label>
        <Select
          onValueChange={(value) => {
            props.onPlanChange(value as PlanId);
          }}
          value={props.planId}
        >
          <SelectTrigger id="proposal-plan">
            <SelectValue placeholder="Select a plan" />
          </SelectTrigger>
          <SelectContent>
            {PLAN_OPTIONS.map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>
                {plan.label} · ${plan.pricePerSeatMonthly}/seat
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Text tone="secondary">
          {PLAN_OPTIONS.find((plan) => plan.id === props.planId)?.description}
        </Text>
      </Stack>

      <Stack gap={6}>
        <Label htmlFor="proposal-seats">Seats</Label>
        <Row gap={8}>
          <Button
            aria-label="Decrease seats"
            onClick={() => {
              props.onSeatsChange(props.seats - 1);
            }}
            type="button"
            variant="outline"
          >
            −
          </Button>
          <Text
            id="proposal-seats"
            style={{
              fontVariantNumeric: "tabular-nums",
              fontWeight: 600,
              minWidth: 32,
              textAlign: "center",
            }}
          >
            {props.seats}
          </Text>
          <Button
            aria-label="Increase seats"
            onClick={() => {
              props.onSeatsChange(props.seats + 1);
            }}
            type="button"
            variant="outline"
          >
            +
          </Button>
        </Row>
      </Stack>

      <Row justify="space-between">
        <Stack gap={2}>
          <Text style={{ fontWeight: 600 }}>Priority support</Text>
          <Text tone="secondary">Adds 15% on subscription</Text>
        </Stack>
        <Switch
          checked={props.includeSupport}
          onCheckedChange={props.onSupportChange}
        />
      </Row>

      <Row>
        <Button onClick={props.onReset} type="button" variant="ghost">
          Reset defaults
        </Button>
      </Row>
    </Stack>
  );
}
