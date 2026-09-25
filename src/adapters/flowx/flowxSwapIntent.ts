import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  accountBoundReviewRequiredCheck,
  signingViaLocalReviewOnlyCheck
} from "../../core/review/reviewChecks.js";
import type { ActionPlan } from "../../core/action/types.js";
import { canonicalFlowxSymbol } from "../../core/read/flowxRegistry.js";

export const FLOWX_SWAP_ACTION_KIND = "swap";
export const FLOWX_SWAP_ADAPTER_ID = "flowx-swap";
export const FLOWX_SWAP_PROTOCOL = "FlowXCLMM";

export const flowxSwapIntentInputSchema = z.object({
  type: z.literal(FLOWX_SWAP_ACTION_KIND),
  from: z.object({
    symbol: z.string().min(1),
    amount: z.string().min(1)
  }),
  to: z.object({
    symbol: z.string().min(1)
  }),
  maxSlippageBps: z.number().int().min(1).max(1000)
});

export type FlowxSwapIntentInput = z.infer<typeof flowxSwapIntentInputSchema>;

export type FlowxSwapRequestedIntent = {
  type: typeof FLOWX_SWAP_ACTION_KIND;
  from: {
    symbol: string;
    amountDisplay: string;
  };
  to: {
    symbol: string;
  };
  maxSlippageBps: number;
};

export const flowxSwapRequestedIntentSchema: z.ZodType<FlowxSwapRequestedIntent> = z.object({
  type: z.literal(FLOWX_SWAP_ACTION_KIND),
  from: z.object({
    symbol: z.string().min(1),
    amountDisplay: z.string().min(1)
  }),
  to: z.object({
    symbol: z.string().min(1)
  }),
  maxSlippageBps: z.number().int().min(1).max(1000)
});

export function createFlowxSwapActionPlan(
  intent: FlowxSwapIntentInput,
  now: Date
): ActionPlan<FlowxSwapActionPlanData> {
  const requestedIntent = normalizeFlowxSwapRequestedIntent(intent);
  return {
    id: `plan_${randomUUID()}`,
    actionKind: FLOWX_SWAP_ACTION_KIND,
    adapterId: FLOWX_SWAP_ADAPTER_ID,
    protocol: FLOWX_SWAP_PROTOCOL,
    title: `Review ${requestedIntent.from.amountDisplay} ${requestedIntent.from.symbol} to ${requestedIntent.to.symbol}`,
    summary:
      "Account-bound FlowX review evidence is computed after a wallet account is connected. The internal Review card displays the proposal and verified review evidence; when every evidence stage completes, the Review card can request user-controlled wallet approval through the backend. This MCP response contains no sign action, signing data, transaction bytes, or signing readiness.",
    assetFlowPreview: {
      outgoing: [
        { symbol: requestedIntent.from.symbol, amount: requestedIntent.from.amountDisplay, amountKind: "display_intent" }
      ],
      expectedIncoming: [
        { symbol: requestedIntent.to.symbol, amount: "unknown", amountKind: "display_intent", approx: true }
      ]
    },
    adapterData: {
      requestedIntent
    },
    createdAt: now.toISOString(),
    preliminaryChecks: [accountBoundReviewRequiredCheck(), signingViaLocalReviewOnlyCheck()]
  };
}

export type FlowxSwapActionPlanData = {
  requestedIntent: FlowxSwapRequestedIntent;
};

export const flowxSwapActionPlanDataSchema: z.ZodType<FlowxSwapActionPlanData> = z.object({
  requestedIntent: flowxSwapRequestedIntentSchema
});

export type FlowxSwapActionPlanIdentity = ActionPlan & {
  actionKind: typeof FLOWX_SWAP_ACTION_KIND;
  adapterId: typeof FLOWX_SWAP_ADAPTER_ID;
  protocol: typeof FLOWX_SWAP_PROTOCOL;
};

export const flowxSwapActionPlanIdentitySchema = z.object({
  actionKind: z.literal(FLOWX_SWAP_ACTION_KIND),
  adapterId: z.literal(FLOWX_SWAP_ADAPTER_ID),
  protocol: z.literal(FLOWX_SWAP_PROTOCOL)
}).loose();

export function isFlowxSwapActionPlanIdentity(plan: ActionPlan): plan is FlowxSwapActionPlanIdentity {
  return flowxSwapActionPlanIdentitySchema.safeParse(plan).success;
}

export function normalizeFlowxSwapRequestedIntent(input: FlowxSwapIntentInput): FlowxSwapRequestedIntent {
  const fromSymbol = canonicalFlowxSymbol(input.from.symbol)?.symbol ?? input.from.symbol.trim();
  const toSymbol = canonicalFlowxSymbol(input.to.symbol)?.symbol ?? input.to.symbol.trim();
  return {
    type: FLOWX_SWAP_ACTION_KIND,
    from: {
      symbol: fromSymbol,
      amountDisplay: input.from.amount
    },
    to: {
      symbol: toSymbol
    },
    maxSlippageBps: input.maxSlippageBps
  };
}
