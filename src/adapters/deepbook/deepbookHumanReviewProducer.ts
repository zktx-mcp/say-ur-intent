import type {
  DeepbookSwapActionPlanIdentity,
  DeepbookSwapRequestedIntent
} from "./deepbookSwapIntent.js";
import type { DeepbookSwapQuotePolicyOk } from "./deepbookQuotePolicy.js";
import type { DeepbookSwapPoolResolution } from "./deepbookTransactionMaterialProducer.js";
import type {
  HumanReadableReviewEvidence
} from "../../core/action/humanReadableReviewEvidence.js";
import {
  createSwapHumanReadableReviewEvidence
} from "../../core/action/swapHumanReadableReviewProjection.js";
import type {
  BlockedReason,
  HumanReadableReviewSummary,
  ReviewCheck,
  SwapHumanReadableReviewAmount
} from "../../core/action/types.js";
import type { SwapQuotePolicyEvidence } from "../../core/action/swapQuotePolicyEvidence.js";
import type { TransactionObjectOwnershipEvidence } from "../../core/action/transactionObjectOwnershipEvidence.js";
import type {
  LocalTransactionMaterialDigestCommitment,
  LocalTransactionMaterialHandle
} from "../../core/session/transactionMaterialStore.js";
import {
  failReviewCheck,
  passReviewCheck
} from "../../core/review/reviewComputationResult.js";

export type DeepbookSwapHumanReadableReviewProducerInput = {
  plan: DeepbookSwapActionPlanIdentity;
  account: string;
  requestedIntent: DeepbookSwapRequestedIntent;
  poolResolution: DeepbookSwapPoolResolution;
  quotePolicy: DeepbookSwapQuotePolicyOk;
  transactionMaterial: LocalTransactionMaterialHandle;
  transactionMaterialDigest: LocalTransactionMaterialDigestCommitment;
  swapQuotePolicy: SwapQuotePolicyEvidence;
  transactionObjectOwnership: TransactionObjectOwnershipEvidence;
  now: Date;
};

export type DeepbookSwapHumanReadableReviewProducerOutcome =
  | {
      status: "completed";
      evidence: HumanReadableReviewEvidence;
      checks: ReviewCheck[];
    }
  | {
      status: "blocked";
      blockedReason: BlockedReason;
      checks: [ReviewCheck, ...ReviewCheck[]];
    };

export type DeepbookSwapHumanReadableReviewProducer = (
  input: DeepbookSwapHumanReadableReviewProducerInput
) => DeepbookSwapHumanReadableReviewProducerOutcome | Promise<DeepbookSwapHumanReadableReviewProducerOutcome>;

export function createDeepbookSwapHumanReadableReviewProducer(): DeepbookSwapHumanReadableReviewProducer {
  return (input) => {
    try {
      assertDeepbookHumanReviewSources(input);
      const review = buildDeepbookHumanReadableReview(input);
      const evidence = createSwapHumanReadableReviewEvidence({
        transactionMaterial: input.transactionMaterial,
        transactionMaterialDigest: input.transactionMaterialDigest,
        swapQuotePolicy: input.swapQuotePolicy,
        transactionObjectOwnership: input.transactionObjectOwnership,
        adapterId: input.plan.adapterId,
        protocol: input.plan.protocol,
        actionKind: input.plan.actionKind,
        review,
        derivedAt: input.now
      });
      return {
        status: "completed",
        evidence,
        checks: [
          passReviewCheck(
            "deepbook_human_readable_review_evidence",
            "Human-readable review",
            "Prepared a human-readable account-bound swap review from material-bound quote policy and object ownership evidence. This is not wallet handoff, signing data, signing readiness, or execution readiness.",
            "adapter"
          )
        ]
      };
    } catch (error) {
      return {
        status: "blocked",
        blockedReason: classifyHumanReviewFailure(error),
        checks: [
          failReviewCheck(
            "deepbook_human_readable_review_failed",
            "Human-readable review",
            error instanceof Error ? error.message : "DeepBook human-readable review evidence could not be produced.",
            "adapter"
          )
        ]
      };
    }
  };
}

function buildDeepbookHumanReadableReview(
  input: DeepbookSwapHumanReadableReviewProducerInput
): HumanReadableReviewSummary {
  const sourceAmount = amountFromQuotePolicy("input", input.swapQuotePolicy.sourceAmount, {
    displayAmount: input.requestedIntent.from.amountDisplay,
    displayAmountSource: "user_display_intent_not_signing_input"
  });
  const expectedOutput = amountFromQuotePolicy("expected_output", input.swapQuotePolicy.expectedOutput);
  const minimumOutput = amountFromQuotePolicy("minimum_output", input.swapQuotePolicy.minimumOutput);
  const protocolFee = amountFromQuotePolicy("fee", input.swapQuotePolicy.protocolFee);
  return {
    kind: "swap_human_readable_review",
    proposedAction: {
      title: input.plan.title,
      summary: input.plan.summary,
      actionKind: input.plan.actionKind,
      adapterId: input.plan.adapterId,
      protocol: input.plan.protocol,
      network: "sui:mainnet"
    },
    assetFlow: {
      outgoing: [sourceAmount],
      expectedIncoming: [expectedOutput],
      minimumIncoming: [minimumOutput],
      fees: [protocolFee]
    },
    recipients: [
      { role: "connected_account", address: input.account },
      { role: "output_recipient", address: input.account }
    ],
    targets: [
      {
        kind: "swap_output_asset",
        symbol: input.swapQuotePolicy.expectedOutput.asset.symbol,
        coinType: input.swapQuotePolicy.expectedOutput.asset.coinType,
        protocol: input.plan.protocol,
        poolKey: input.swapQuotePolicy.quoteSource.poolKey,
        direction: input.swapQuotePolicy.quoteSource.direction
      }
    ],
    evidenceUsed: [
      {
        id: "deepbook_quote_policy",
        label: "Quote policy",
        source: "quote",
        summary: "Quote policy evidence supplies the input, expected output, minimum output, protocol fee, and slippage policy shown in asset flow; it is not route choice or signing readiness."
      },
      {
        id: "transaction_material_digest",
        label: "Transaction material digest",
        source: "digest_commitment",
        summary: "The review is bound internally to the stored local unsigned transaction material digest; the digest and transaction bytes are not public review output."
      },
      {
        id: "transaction_object_ownership",
        label: "Object ownership",
        source: "wallet",
        summary: "Object ownership evidence is derived from stored transaction data and Sui mainnet object reads."
      }
    ],
    missingEvidence: [
      {
        id: "review_time_simulation",
        label: "Review-time simulation",
        reason: "The review has not simulated the stored transaction material with required effects, balance changes, object types, and transaction fields."
      }
    ],
    requiredUserChoices: [
      {
        id: "wallet_authorization_later",
        label: "Wallet authorization",
        reason: "The backend requests a signature only after your explicit Review card action; nothing is signed without your approval in the wallet."
      }
    ],
    unsupportedClaims: [
      {
        id: "no_signing_readiness",
        label: "No signing readiness",
        reason: "Human-readable review evidence does not prove the action is ready to sign."
      },
      {
        id: "no_execution_readiness",
        label: "No execution readiness",
        reason: "Review-time simulation, wallet handoff, signing, and execution receipt evidence are not complete."
      },
      {
        id: "no_route_recommendation",
        label: "No route recommendation",
        reason: "The account-bound swap review uses an explicit direct pool path and does not rank venues or recommend routes."
      }
    ],
    freshness: {
      status: "current",
      evaluatedAt: input.now.toISOString(),
      expiresAt: input.transactionMaterial.expiresAt,
      reason: "Human-readable review evidence expires with the stored local transaction material and quote policy."
    },
    blockingChecks: [
      failReviewCheck(
        "deepbook_review_time_simulation_missing",
        "Review-time simulation",
        "Review-time simulation evidence is still required before any wallet handoff, signing, or execution.",
        "simulation"
      )
    ]
  };
}

function assertDeepbookHumanReviewSources(
  input: DeepbookSwapHumanReadableReviewProducerInput
): void {
  if (
    input.swapQuotePolicy.adapterId !== input.plan.adapterId ||
    input.swapQuotePolicy.protocol !== input.plan.protocol ||
    input.swapQuotePolicy.actionKind !== input.plan.actionKind
  ) {
    throw new Error("human-readable review quote policy identity must match the action plan");
  }
  if (input.swapQuotePolicy.quoteSource.poolKey !== input.poolResolution.poolKey) {
    throw new Error("human-readable review pool target must match swap quote policy poolKey");
  }
  if (input.swapQuotePolicy.quoteSource.direction !== input.quotePolicy.direction) {
    throw new Error("human-readable review target direction must match swap quote policy direction");
  }
}

function classifyHumanReviewFailure(error: unknown): BlockedReason {
  const message = error instanceof Error ? error.message : "";
  if (/object ownership/i.test(message)) {
    return "object_resolution_failed";
  }
  if (/asset|target|pool|direction|protocol|adapter/i.test(message)) {
    return "asset_mismatch";
  }
  if (/amount|quote|slippage|min/i.test(message)) {
    return "amount_mismatch";
  }
  return "unsupported_action";
}

function amountFromQuotePolicy(
  role: SwapHumanReadableReviewAmount["role"],
  amount: SwapQuotePolicyEvidence["sourceAmount"],
  display?: Pick<SwapHumanReadableReviewAmount, "displayAmount" | "displayAmountSource">
): SwapHumanReadableReviewAmount {
  return {
    role,
    symbol: amount.asset.symbol,
    coinType: amount.asset.coinType,
    decimals: amount.asset.decimals,
    rawAmount: amount.raw,
    rawAmountSource: "quote_policy_evidence",
    ...(display?.displayAmount ? { displayAmount: display.displayAmount } : {}),
    ...(display?.displayAmountSource ? { displayAmountSource: display.displayAmountSource } : {})
  };
}
