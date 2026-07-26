/** Shared types for the workbench proposal stress demo (no React). */

export type PlanId = "starter" | "pro" | "scale";

export interface PlanOption {
  id: PlanId;
  label: string;
  pricePerSeatMonthly: number;
  description: string;
}

export interface ProposalLine {
  id: string;
  label: string;
  amount: number;
}
