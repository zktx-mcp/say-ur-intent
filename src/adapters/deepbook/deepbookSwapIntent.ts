import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  accountBoundReviewRequiredCheck,
  signingViaLocalReviewOnlyCheck
} from "../../core/review/reviewChecks.js";
import type { ActionPlan } from "../../core/action/types.js";
import { canonicalDeepbookSymbol } from "../../core/read/deepbookRegistry.js";

export const DEEPBOOK_SWAP_ACTION_KIND = "swap";
export const DEEPBOOK_SWAP_ADAPTER_ID = "deepbook-swap";
export const DEEPBOOK_SWAP_PROTOCOL = "DeepBookV3";

export const deepbookSwapIntentInputSchema = z.object({
  type: z.literal(DEEPBOOK_SWAP_ACTION_KIND),
  from: z.object({
    symbol: z.string().min(1),
    amount: z.string().min(1)
  }),
  to: z.object({
    symbol: z.string().min(1)
  }),
  maxSlippageBps: z.number().int().min(1).max(1000)
});

export type DeepbookSwapIntentInput = z.infer<typeof deepbookSwapIntentInputSchema>;

export type DeepbookSwapRequestedIntent = {
  type: typeof DEEPBOOK_SWAP_ACTION_KIND;
  from: {
    symbol: string;
    amountDisplay: string;
  };
  to: {
    symbol: string;
  };
  maxSlippageBps: number;
};

export const deepbookSwapRequestedIntentSchema: z.ZodType<DeepbookSwapRequestedIntent> = z.object({
  type: z.literal(DEEPBOOK_SWAP_ACTION_KIND),
  from: z.object({
    symbol: z.string().min(1),
    amountDisplay: z.string().min(1)
  }),
  to: z.object({
    symbol: z.string().min(1)
  }),
  maxSlippageBps: z.number().int().min(1).max(1000)
});

export function createDeepbookSwapActionPlan(
  intent: DeepbookSwapIntentInput,
  now: Date
): ActionPlan<DeepbookSwapActionPlanData> {
  const requestedIntent = normalizeDeepbookSwapRequestedIntent(intent);
  return {
    id: `plan_${randomUUID()}`,
    actionKind: DEEPBOOK_SWAP_ACTION_KIND,
    adapterId: DEEPBOOK_SWAP_ADAPTER_ID,
    protocol: DEEPBOOK_SWAP_PROTOCOL,
    title: `Review ${requestedIntent.from.amountDisplay} ${requestedIntent.from.symbol} to ${requestedIntent.to.symbol}`,
    summary:
      "Account-bound DeepBook review evidence is computed after a wallet account is connected. The internal Review card displays the proposal and verified review evidence; when every evidence stage completes, the Review card can request user-controlled wallet approval through the backend. This MCP response contains no sign action, signing data, transaction bytes, or signing readiness.",
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

export type DeepbookSwapActionPlanData = {
  requestedIntent: DeepbookSwapRequestedIntent;
};

export const deepbookSwapActionPlanDataSchema: z.ZodType<DeepbookSwapActionPlanData> = z.object({
  requestedIntent: deepbookSwapRequestedIntentSchema
});

export type DeepbookSwapActionPlanIdentity = ActionPlan & {
  actionKind: typeof DEEPBOOK_SWAP_ACTION_KIND;
  adapterId: typeof DEEPBOOK_SWAP_ADAPTER_ID;
  protocol: typeof DEEPBOOK_SWAP_PROTOCOL;
};

export const deepbookSwapActionPlanIdentitySchema = z.object({
  actionKind: z.literal(DEEPBOOK_SWAP_ACTION_KIND),
  adapterId: z.literal(DEEPBOOK_SWAP_ADAPTER_ID),
  protocol: z.literal(DEEPBOOK_SWAP_PROTOCOL)
}).loose();

export function isDeepbookSwapActionPlanIdentity(plan: ActionPlan): plan is DeepbookSwapActionPlanIdentity {
  return deepbookSwapActionPlanIdentitySchema.safeParse(plan).success;
}

export function normalizeDeepbookSwapRequestedIntent(input: DeepbookSwapIntentInput): DeepbookSwapRequestedIntent {
  const fromSymbol = canonicalDeepbookSymbol(input.from.symbol) ?? input.from.symbol.trim();
  const toSymbol = canonicalDeepbookSymbol(input.to.symbol) ?? input.to.symbol.trim();
  return {
    type: DEEPBOOK_SWAP_ACTION_KIND,
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
