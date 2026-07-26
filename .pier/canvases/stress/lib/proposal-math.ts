import type { PlanId, PlanOption, ProposalLine } from "./proposal-types.ts";

export type { PlanId, PlanOption, ProposalLine } from "./proposal-types.ts";

export const PLAN_OPTIONS: PlanOption[] = [
  {
    description: "Core panels · single seat default",
    id: "starter",
    label: "Starter",
    pricePerSeatMonthly: 12,
  },
  {
    description: "Worktrees · priority support",
    id: "pro",
    label: "Pro",
    pricePerSeatMonthly: 28,
  },
  {
    description: "SSO · audit log · volume seats",
    id: "scale",
    label: "Scale",
    pricePerSeatMonthly: 42,
  },
];

export function findPlan(id: PlanId): PlanOption {
  const plan = PLAN_OPTIONS.find((item) => item.id === id);
  if (!plan) {
    throw new Error(`unknown plan: ${id}`);
  }
  return plan;
}

/** Pure pricing — pulls multi-file graph into the compile bundle. */
export function buildProposalLines(input: {
  planId: PlanId;
  seats: number;
  includeSupport: boolean;
}): ProposalLine[] {
  const plan = findPlan(input.planId);
  const seats = Math.max(1, Math.min(50, Math.floor(input.seats)));
  const subscription = plan.pricePerSeatMonthly * seats;
  const support = input.includeSupport ? Math.round(subscription * 0.15) : 0;
  const tax = Math.round((subscription + support) * 0.08 * 100) / 100;

  return [
    {
      amount: subscription,
      id: "sub",
      label: `${plan.label} · ${seats} seats / mo`,
    },
    ...(support > 0
      ? [
          {
            amount: support,
            id: "support",
            label: "Priority support (15%)",
          } satisfies ProposalLine,
        ]
      : []),
    {
      amount: tax,
      id: "tax",
      label: "Tax (est. 8%)",
    },
  ];
}

export function sumLines(lines: ProposalLine[]): number {
  return Math.round(lines.reduce((acc, line) => acc + line.amount, 0) * 100) / 100;
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(amount);
}
