import { z } from "zod";
import type { ActionPlan } from "../core/action/types.js";
import {
  createDeepbookSwapActionPlan,
  DEEPBOOK_SWAP_ACTION_KIND,
  DEEPBOOK_SWAP_ADAPTER_ID,
  DEEPBOOK_SWAP_PROTOCOL
} from "./deepbook/deepbookSwapIntent.js";

/**
 * Protocol-neutral swap intent. The optional `protocol` field carries the
 * protocol slug (same slug vocabulary as the adapter prompt surfaces). When
 * several protocols support the same action kind, the caller must name one -
 * the entry point never picks a venue silently.
 */
export const swapIntentInputSchema = z.object({
  type: z.literal("swap"),
  from: z.object({
    symbol: z.string().min(1),
    amount: z.string().min(1)
  }),
  to: z.object({
    symbol: z.string().min(1)
  }),
  maxSlippageBps: z.number().int().min(1).max(1000),
  protocol: z
    .string()
    .min(1)
    .optional()
    .describe("Protocol slug, required only when several protocols support the action")
});

export type SwapIntentInput = z.infer<typeof swapIntentInputSchema>;

/**
 * One intent-to-plan factory contributed by a review adapter. Factories are
 * static metadata (no runtime wiring), mirroring the prompt-surface registry:
 * registering a second protocol for the same action automatically turns the
 * entry point into explicit-choice mode.
 */
export type IntentPlanFactory = {
  adapterId: string;
  actionKind: string;
  protocolSlug: string;
  protocol: string;
  createPlan: (intent: Omit<SwapIntentInput, "protocol">, now: Date) => ActionPlan;
};

export const INTENT_PLAN_FACTORIES: readonly IntentPlanFactory[] = [
  {
    adapterId: DEEPBOOK_SWAP_ADAPTER_ID,
    actionKind: DEEPBOOK_SWAP_ACTION_KIND,
    protocolSlug: "deep",
    protocol: DEEPBOOK_SWAP_PROTOCOL,
    createPlan: (intent, now) => createDeepbookSwapActionPlan({ ...intent, type: "swap" }, now)
  }
];

export type IntentPlanResolution =
  | { status: "resolved"; factory: IntentPlanFactory }
  | { status: "unsupported_action"; actionKind: string }
  | { status: "unknown_protocol"; protocolSlug: string; available: string[] }
  | { status: "protocol_choice_required"; available: string[] };

export function resolveIntentPlanFactory(
  factories: readonly IntentPlanFactory[],
  actionKind: string,
  protocolSlug?: string
): IntentPlanResolution {
  const group = factories.filter((factory) => factory.actionKind === actionKind);
  if (group.length === 0) {
    return { status: "unsupported_action", actionKind };
  }
  const available = group.map((factory) => factory.protocolSlug);
  if (protocolSlug !== undefined) {
    const factory = group.find((candidate) => candidate.protocolSlug === protocolSlug.trim());
    if (!factory) {
      return { status: "unknown_protocol", protocolSlug, available };
    }
    return { status: "resolved", factory };
  }
  if (group.length === 1 && group[0]) {
    return { status: "resolved", factory: group[0] };
  }
  return { status: "protocol_choice_required", available };
}
