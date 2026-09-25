import { flowxSwapActionPlanDataSchema } from "./flowxSwapIntent.js";
import type { FlowxSwapActionPlanIdentity, FlowxSwapRequestedIntent } from "./flowxSwapIntent.js";
import { deriveFlowxSwapQuotePolicy, type FlowxSwapQuotePolicyOk } from "./flowxSwapQuotePolicy.js";
import {
  flowxSwapReviewLifecycleStageLabel,
  newFlowxSwapReviewLifecycle,
  type FlowxSwapReviewLifecycle,
  type FlowxSwapReviewLifecycleStage
} from "./flowxSwapReviewLifecycle.js";
import type {
  FlowxSwapTransactionMaterialDigestProducer,
  FlowxSwapTransactionMaterialProducer
} from "./flowxSwapTransactionMaterialProducer.js";
import type { FlowxSwapHumanReadableReviewProducer } from "./flowxSwapHumanReviewProducer.js";
import type { TransactionObjectOwnershipProducer } from "../../core/action/transactionObjectOwnershipProducer.js";
import type {
  ActionPlan,
  BlockedReason,
  HumanReadableReviewSummary,
  RefreshReason,
  ReviewCheck,
  SuccessfulTransactionSimulationSummary
} from "../../core/action/types.js";
import { createSwapQuotePolicyEvidence } from "../../core/action/swapQuotePolicyEvidence.js";
import { publicHumanReadableReviewFromEvidence } from "../../core/action/humanReadableReviewEvidence.js";
import {
  publicTransactionSimulationSummaryFromEvidence,
  type ReviewTimeSimulationProducer
} from "../../core/action/reviewTimeSimulationEvidence.js";
import { parseQuoteDisplayAmount } from "../../core/read/deepbookReadHelpers.js";
import { validateFlowxRouteQuote } from "../../core/read/flowxReadHelpers.js";
import {
  FLOWX_CLMM_UNIT_SOURCE,
  resolveFlowxSwapPair,
  type FlowxCoinMeta
} from "../../core/read/flowxRegistry.js";
import {
  ReadServiceInputError,
  type FlowxQuotedPoolEvidence,
  type FlowxRouteQuote
} from "../../core/read/readServiceTypes.js";
import {
  blockedAdapterLifecycleReviewResult,
  failReviewCheck,
  passReviewCheck,
  producerStageMissingReviewResult,
  refreshRequiredAdapterLifecycleReviewResult,
  walletReviewContractEmitMissingResult,
  walletReviewContractEmittedResult,
  type ReviewComputationResult
} from "../../core/review/reviewComputationResult.js";
import { assembleTransactionReviewData } from "../../core/action/walletReviewContractAssembler.js";
import type { PtbVisualizationOutcome } from "../../core/action/ptbVisualizationProducer.js";
import type { PtbVisualizationArtifact } from "../../core/action/signableAdapterContract.js";
import type { PrivateReviewArtifacts } from "../../core/session/privateReviewArtifacts.js";
import type {
  LocalTransactionMaterialDigestCommitment,
  LocalTransactionMaterialHandle
} from "../../core/session/transactionMaterialStore.js";

/**
 * Build-grade quote source: returns the normalized route quote for validation
 * plus the SDK route entities the material build consumes, so one quoter
 * response feeds quote evidence, policy, and build without re-fetching.
 */
export type FlowxSwapReviewQuoteSource = {
  getSwapRoutesForBuild(input: {
    tokenInType: string;
    tokenOutType: string;
    amountInRaw: string;
  }): Promise<{ normalized: FlowxRouteQuote; sdkRoutes: unknown; fetchedAt: string }>;
};

export type FlowxSwapPairEvidence = {
  source: FlowxCoinMeta;
  target: FlowxCoinMeta;
  swapXToY: boolean;
  pinnedPoolCount: number;
};

export type FlowxSwapRouteQuoteEvidence = {
  amountInRaw: string;
  amountOutRaw: string;
  swapXToY: boolean;
  pools: FlowxQuotedPoolEvidence[];
  sdkRoutes: unknown;
  fetchedAt: string;
};

export type FlowxPtbVisualizationProducer = (input: {
  transactionMaterial: LocalTransactionMaterialHandle;
  transactionMaterialDigest: LocalTransactionMaterialDigestCommitment;
  adapterId: string;
  planId: string;
  now: Date;
}) => Promise<PtbVisualizationOutcome>;

export type FlowxSwapReviewEvidenceInput = {
  reviewSessionId: string;
  plan: FlowxSwapActionPlanIdentity;
  account: string;
  now?: Date | undefined;
  quoteSource: FlowxSwapReviewQuoteSource;
  transactionMaterialProducer?: FlowxSwapTransactionMaterialProducer | undefined;
  transactionMaterialDigestProducer?: FlowxSwapTransactionMaterialDigestProducer | undefined;
  transactionObjectOwnershipProducer?: TransactionObjectOwnershipProducer | undefined;
  humanReadableReviewProducer?: FlowxSwapHumanReadableReviewProducer | undefined;
  reviewTimeSimulationProducer?: ReviewTimeSimulationProducer | undefined;
  ptbVisualizationProducer?: FlowxPtbVisualizationProducer | undefined;
};

export type FlowxSwapReviewEvidenceResult = {
  result: ReviewComputationResult;
  privateArtifacts?: PrivateReviewArtifacts;
};

export async function computeFlowxSwapReviewEvidence(
  input: FlowxSwapReviewEvidenceInput
): Promise<FlowxSwapReviewEvidenceResult> {
  const lifecycle = newFlowxSwapReviewLifecycle(input.plan);
  const checks: ReviewCheck[] = [];
  const now = input.now ?? new Date();

  const intentStage = await runFlowxReviewStage({
    lifecycle,
    checks,
    stage: "intent_normalized",
    run: () => normalizeIntentStage(input.plan)
  });
  if (!intentStage.ok) {
    return { result: intentStage.result };
  }
  const requestedIntent = intentStage.evidence;

  const pairStage = await runFlowxReviewStage({
    lifecycle,
    checks,
    stage: "pair_resolved",
    run: () => resolvePairStage(requestedIntent)
  });
  if (!pairStage.ok) {
    return { result: pairStage.result };
  }
  const pairEvidence = pairStage.evidence;

  const quoteStage = await runFlowxReviewStage({
    lifecycle,
    checks,
    stage: "quote_evidence_fetched",
    run: () => quoteEvidenceStage(input, requestedIntent, pairEvidence)
  });
  if (!quoteStage.ok) {
    return { result: quoteStage.result };
  }
  const quoteEvidence = quoteStage.evidence;

  const policyStage = await runFlowxReviewStage({
    lifecycle,
    checks,
    stage: "quote_policy_derived",
    run: () => quotePolicyStage(requestedIntent, quoteEvidence, now)
  });
  if (!policyStage.ok) {
    return { result: policyStage.result };
  }
  const quotePolicy = policyStage.evidence;

  if (!input.transactionMaterialProducer) {
    return { result: missingProducerStageBlockedResult(lifecycle.snapshot(), checks) };
  }

  const materialStage = await runFlowxReviewStage({
    lifecycle,
    checks,
    stage: "transaction_material_build_or_verify",
    run: () =>
      input.transactionMaterialProducer!({
        reviewSessionId: input.reviewSessionId,
        plan: input.plan,
        account: input.account,
        requestedIntent,
        pairEvidence,
        quoteEvidence,
        quotePolicy,
        now
      })
  });
  if (!materialStage.ok) {
    return { result: materialStage.result };
  }

  if (!input.transactionMaterialDigestProducer) {
    return { result: missingProducerStageBlockedResult(lifecycle.snapshot(), checks) };
  }

  const digestStage = await runFlowxReviewStage({
    lifecycle,
    checks,
    stage: "digest_commitment",
    run: () => input.transactionMaterialDigestProducer!({ materialHandle: materialStage.evidence, now })
  });
  if (!digestStage.ok) {
    return { result: digestStage.result };
  }

  const routedPool = quoteEvidence.pools[0];
  if (!routedPool) {
    checks.push(
      failReviewCheck(
        "flowx_quote_policy_material_binding_failed",
        "Quote policy material binding",
        "FlowX route quote evidence lost its single routed pool before quote policy binding.",
        "quote"
      )
    );
    return { result: blockedAdapterLifecycleReviewResult("amount_mismatch", checks, lifecycle.snapshot()) };
  }

  let swapQuotePolicy;
  try {
    swapQuotePolicy = createSwapQuotePolicyEvidence({
      materialHandle: materialStage.evidence,
      adapterId: input.plan.adapterId,
      protocol: input.plan.protocol,
      actionKind: input.plan.actionKind,
      quoteEvidenceId: `flowx_route_quote:${input.plan.id}`,
      quoteSource: {
        provider: input.plan.protocol,
        poolKey: routedPool.poolKey,
        direction: quotePolicy.swapXToY ? "base_to_quote" : "quote_to_base",
        fetchedAt: quotePolicy.fetchedAt,
        sourceMoveFunction: "universal_router::build"
      },
      maxSlippageBps: quotePolicy.maxSlippageBps,
      staleAfterMs: quotePolicy.staleAfterMs,
      sourceAmount: flowxQuotePolicyAmount(quotePolicy.sourceAmountRaw, pairEvidence.source),
      expectedOutput: flowxQuotePolicyAmount(quotePolicy.expectedOutRaw, pairEvidence.target),
      minimumOutput: flowxQuotePolicyAmount(quotePolicy.minOutRaw, pairEvidence.target),
      // The FlowX CLMM swap fee is charged inside the pool at the pinned fee
      // rate and is already reflected in the quoted output, so no separate
      // fee asset leaves the account.
      protocolFee: flowxQuotePolicyAmount("0", pairEvidence.source),
      derivedAt: new Date(Math.max(now.getTime(), Date.parse(quotePolicy.fetchedAt)))
    });
  } catch (error) {
    checks.push(
      failReviewCheck(
        "flowx_quote_policy_material_binding_failed",
        "Quote policy material binding",
        error instanceof Error ? error.message : "FlowX quote policy evidence did not match the stored transaction material.",
        "quote"
      )
    );
    return { result: blockedAdapterLifecycleReviewResult("amount_mismatch", checks, lifecycle.snapshot()) };
  }

  const privateArtifacts: PrivateReviewArtifacts = {
    transactionMaterial: materialStage.evidence,
    transactionMaterialDigest: digestStage.evidence,
    swapQuotePolicy
  };

  let ptbVisualization: PtbVisualizationArtifact | undefined;
  if (input.ptbVisualizationProducer) {
    const rendered = await input.ptbVisualizationProducer({
      transactionMaterial: materialStage.evidence,
      transactionMaterialDigest: digestStage.evidence,
      adapterId: input.plan.adapterId,
      planId: input.plan.id,
      now
    });
    if (rendered.status === "rendered") {
      ptbVisualization = rendered.artifact;
      checks.push(
        passReviewCheck(
          "flowx_ptb_visualization",
          "PTB visualization",
          "Rendered a Mermaid PTB visualization artifact from the stored local transaction material. Visualization only; it is not wallet authorization, not signing data, not signing readiness, and not execution readiness.",
          "adapter"
        )
      );
    } else {
      checks.push({
        id: "flowx_ptb_visualization_unavailable",
        label: "PTB visualization",
        status: "warning",
        message: `PTB visualization is unavailable for this review: ${rendered.reason}. The emitted wallet review contract remains valid; visualization is optional review evidence.`,
        source: "adapter"
      });
    }
  }
  const withPtb = (result: ReviewComputationResult): ReviewComputationResult =>
    ptbVisualization ? { ...result, ptbVisualization } : result;

  if (!input.transactionObjectOwnershipProducer) {
    return {
      result: withPtb(missingProducerStageBlockedResult(lifecycle.snapshot(), checks)),
      privateArtifacts
    };
  }

  const ownershipStage = await runFlowxReviewStage({
    lifecycle,
    checks,
    stage: "object_ownership",
    run: () =>
      input.transactionObjectOwnershipProducer!({
        materialHandle: materialStage.evidence,
        materialDigest: digestStage.evidence,
        now
      })
  });
  if (!ownershipStage.ok) {
    return {
      result: withPtb(ownershipStage.result),
      ...(ownershipStage.result.status === "refresh_required" ? {} : { privateArtifacts })
    };
  }
  privateArtifacts.transactionObjectOwnership = ownershipStage.evidence;

  if (!input.humanReadableReviewProducer) {
    return {
      result: withPtb(missingProducerStageBlockedResult(lifecycle.snapshot(), checks)),
      privateArtifacts
    };
  }

  const humanReviewStage = await runFlowxReviewStage({
    lifecycle,
    checks,
    stage: "human_readable_review",
    run: () =>
      input.humanReadableReviewProducer!({
        plan: input.plan,
        account: input.account,
        requestedIntent,
        pairEvidence,
        routedPool,
        quotePolicy,
        transactionMaterial: materialStage.evidence,
        transactionMaterialDigest: digestStage.evidence,
        swapQuotePolicy,
        transactionObjectOwnership: ownershipStage.evidence,
        now
      })
  });
  if (!humanReviewStage.ok) {
    return { result: withPtb(humanReviewStage.result), privateArtifacts };
  }
  privateArtifacts.humanReadableReview = humanReviewStage.evidence;

  if (!input.reviewTimeSimulationProducer) {
    return {
      result: withPtb(
        missingProducerStageBlockedResult(lifecycle.snapshot(), checks, {
          humanReadableReview: publicHumanReadableReviewFromEvidence(humanReviewStage.evidence)
        })
      ),
      privateArtifacts
    };
  }

  const simulationStage = await runFlowxReviewStage({
    lifecycle,
    checks,
    stage: "review_time_simulation",
    run: () =>
      input.reviewTimeSimulationProducer!({
        transactionMaterial: materialStage.evidence,
        transactionMaterialDigest: digestStage.evidence,
        now
      })
  });
  if (!simulationStage.ok) {
    return {
      result: withPtb({
        ...simulationStage.result,
        humanReadableReview: publicHumanReadableReviewFromEvidence(humanReviewStage.evidence)
      }),
      privateArtifacts
    };
  }
  privateArtifacts.reviewTimeSimulation = simulationStage.evidence;

  const assembly = assembleTransactionReviewData({
    adapterId: input.plan.adapterId,
    protocol: input.plan.protocol,
    actionKind: input.plan.actionKind,
    provenance: {
      kind: "mcp_action_request",
      sourceId: input.plan.id,
      capturedAt: input.plan.createdAt
    },
    quotePolicy: swapQuotePolicy,
    objectOwnership: ownershipStage.evidence,
    humanReadableReview: humanReviewStage.evidence,
    reviewTimeSimulation: simulationStage.evidence,
    reviewedTransactionDigest: digestStage.evidence.transactionDigest,
    now
  });

  if (assembly.status === "emitted") {
    checks.push(
      passReviewCheck(
        "flowx_wallet_review_contract_emitted",
        "Wallet review contract emit",
        "FlowX account-bound review assembled and schema-validated a wallet review contract from verified review evidence. An explicit Review card action can request backend-mediated wallet approval of this exact transaction; ordinary MCP output stays free of signing authority.",
        "adapter"
      )
    );
    return {
      result: walletReviewContractEmittedResult(
        checks,
        lifecycle.snapshot(),
        publicHumanReadableReviewFromEvidence(humanReviewStage.evidence),
        publicTransactionSimulationSummaryFromEvidence(simulationStage.evidence),
        assembly.contract,
        ptbVisualization
      ),
      privateArtifacts
    };
  }

  checks.push(
    failReviewCheck(
      "flowx_wallet_review_contract_emit_missing",
      "Wallet review contract emit",
      `FlowX account-bound review could not assemble the wallet review contract from the current review evidence: ${assembly.reason}. Signing stays blocked.`,
      "adapter"
    )
  );

  return {
    result: walletReviewContractEmitMissingResult(
      checks,
      lifecycle.snapshot(),
      publicHumanReadableReviewFromEvidence(humanReviewStage.evidence),
      publicTransactionSimulationSummaryFromEvidence(simulationStage.evidence)
    ),
    privateArtifacts
  };
}

type FlowxReviewLifecycleController = ReturnType<typeof newFlowxSwapReviewLifecycle>;
type NonEmptyReviewChecks = [ReviewCheck, ...ReviewCheck[]];
type FlowxReviewPublicEvidenceFields = {
  humanReadableReview?: HumanReadableReviewSummary;
  simulation?: SuccessfulTransactionSimulationSummary;
};
type FlowxStageOutcome<TEvidence> =
  | { status: "completed"; evidence: TEvidence; checks: ReviewCheck[] }
  | { status: "blocked"; blockedReason: BlockedReason; checks: NonEmptyReviewChecks }
  | { status: "refresh_required"; refreshReason: RefreshReason; checks: NonEmptyReviewChecks };

type FlowxStageRunResult<TEvidence> =
  | { ok: true; evidence: TEvidence }
  | { ok: false; result: ReviewComputationResult };

async function runFlowxReviewStage<TEvidence>(input: {
  lifecycle: FlowxReviewLifecycleController;
  checks: ReviewCheck[];
  stage: FlowxSwapReviewLifecycleStage;
  run: () => FlowxStageOutcome<TEvidence> | Promise<FlowxStageOutcome<TEvidence>>;
}): Promise<FlowxStageRunResult<TEvidence>> {
  const outcome = await input.run();
  input.checks.push(...outcome.checks);
  if (outcome.status === "completed") {
    input.lifecycle.complete(input.stage);
    return { ok: true, evidence: outcome.evidence };
  }

  const adapterLifecycle = input.lifecycle.snapshot();
  if (outcome.status === "blocked") {
    return {
      ok: false,
      result: blockedAdapterLifecycleReviewResult(outcome.blockedReason, input.checks, adapterLifecycle)
    };
  }

  return {
    ok: false,
    result: refreshRequiredAdapterLifecycleReviewResult(outcome.refreshReason, input.checks, adapterLifecycle)
  };
}

function normalizeIntentStage(plan: ActionPlan): FlowxStageOutcome<FlowxSwapRequestedIntent> {
  const parsedData = flowxSwapActionPlanDataSchema.safeParse(plan.adapterData);
  if (!parsedData.success) {
    return {
      status: "blocked",
      blockedReason: "unsupported_action",
      checks: [
        failReviewCheck(
          "flowx_requested_intent_invalid",
          "Requested FlowX intent",
          "The action plan does not contain a valid FlowX swap display intent.",
          "adapter"
        )
      ]
    };
  }

  const requestedIntent = parsedData.data.requestedIntent;
  return {
    status: "completed",
    evidence: requestedIntent,
    checks: [
      passReviewCheck(
        "flowx_display_intent",
        "Display intent",
        `Requested display intent is ${requestedIntent.from.amountDisplay} ${requestedIntent.from.symbol} to ${requestedIntent.to.symbol} with max slippage ${requestedIntent.maxSlippageBps} bps. This display amount is not signing input.`,
        "adapter"
      )
    ]
  };
}

function resolvePairStage(requestedIntent: FlowxSwapRequestedIntent): FlowxStageOutcome<FlowxSwapPairEvidence> {
  try {
    const resolution = resolveFlowxSwapPair({
      sourceSymbol: requestedIntent.from.symbol,
      targetSymbol: requestedIntent.to.symbol
    });
    const evidence: FlowxSwapPairEvidence = {
      source: resolution.source,
      target: resolution.target,
      swapXToY: resolution.swapXToY,
      pinnedPoolCount: resolution.pools.length
    };
    return {
      status: "completed",
      evidence,
      checks: [
        passReviewCheck(
          "flowx_pair_resolution",
          "FlowX pair",
          `Resolved pinned FlowX pair ${resolution.source.symbol} to ${resolution.target.symbol} (${resolution.pools.length} pinned fee-tier pools; direction ${resolution.swapXToY ? "x_to_y" : "y_to_x"}). The pool used by the swap is chosen by the FlowX router and verified against this pinned set at quote time.`,
          "registry"
        )
      ]
    };
  } catch (error) {
    return {
      status: "blocked",
      blockedReason: "asset_mismatch",
      checks: [
        failReviewCheck(
          "flowx_pair_resolution_failed",
          "FlowX pair",
          error instanceof Error ? error.message : "FlowX pair resolution failed.",
          "registry"
        )
      ]
    };
  }
}

async function quoteEvidenceStage(
  input: FlowxSwapReviewEvidenceInput,
  requestedIntent: FlowxSwapRequestedIntent,
  pairEvidence: FlowxSwapPairEvidence
): Promise<FlowxStageOutcome<FlowxSwapRouteQuoteEvidence>> {
  try {
    const amountInRaw = parseQuoteDisplayAmount(requestedIntent.from.amountDisplay, pairEvidence.source.decimals);
    const fetched = await input.quoteSource.getSwapRoutesForBuild({
      tokenInType: pairEvidence.source.coinType,
      tokenOutType: pairEvidence.target.coinType,
      amountInRaw
    });
    const { pools } = validateFlowxRouteQuote({
      pair: {
        source: pairEvidence.source,
        target: pairEvidence.target,
        swapXToY: pairEvidence.swapXToY,
        pools: []
      },
      requestedAmountInRaw: amountInRaw,
      quote: fetched.normalized
    });
    const evidence: FlowxSwapRouteQuoteEvidence = {
      amountInRaw,
      amountOutRaw: fetched.normalized.amountOutRaw,
      swapXToY: pairEvidence.swapXToY,
      pools,
      sdkRoutes: fetched.sdkRoutes,
      fetchedAt: fetched.fetchedAt
    };
    return {
      status: "completed",
      evidence,
      checks: [
        passReviewCheck(
          "flowx_route_quote_evidence",
          "Route quote evidence",
          `Fetched a FlowX route quote at ${fetched.fetchedAt}: expected output before slippage is ${evidence.amountOutRaw} ${pairEvidence.target.symbol} raw units through pinned pool ${pools.map((pool) => pool.poolKey).join(", ")}. The route was chosen by the FlowX router, not by this review; the review verified the routed pool, direction, fee, and protocol config against the pinned registry.`,
          "quote"
        )
      ]
    };
  } catch (error) {
    return quoteSourceFailureOutcome(error);
  }
}

function quotePolicyStage(
  requestedIntent: FlowxSwapRequestedIntent,
  quoteEvidence: FlowxSwapRouteQuoteEvidence,
  now: Date
): FlowxStageOutcome<FlowxSwapQuotePolicyOk> {
  let policy;
  try {
    policy = deriveFlowxSwapQuotePolicy({
      amountInRaw: quoteEvidence.amountInRaw,
      amountOutRaw: quoteEvidence.amountOutRaw,
      swapXToY: quoteEvidence.swapXToY,
      fetchedAt: quoteEvidence.fetchedAt,
      maxSlippageBps: requestedIntent.maxSlippageBps,
      now
    });
  } catch (error) {
    return {
      status: "blocked",
      blockedReason: "amount_mismatch",
      checks: [
        failReviewCheck(
          "flowx_quote_policy_invalid",
          "Quote policy",
          error instanceof Error ? error.message : "FlowX quote policy could not be derived.",
          "quote"
        )
      ]
    };
  }

  if (policy.status === "refresh_required") {
    return {
      status: "refresh_required",
      refreshReason: policy.refreshReason,
      checks: [
        failReviewCheck(
          "flowx_quote_policy_refresh_required",
          "Quote policy",
          `Quote policy requires refresh: ${policy.reason}. Quote age is ${policy.quoteAgeMs}ms with stale threshold ${policy.staleAfterMs}ms.`,
          "quote"
        )
      ]
    };
  }

  return {
    status: "completed",
    evidence: policy,
    checks: [
      passReviewCheck(
        "flowx_quote_policy",
        "Quote policy",
        `Derived review policy from route quote evidence: sourceAmountRaw ${policy.sourceAmountRaw}, expectedOutRaw ${policy.expectedOutRaw}, minOutRaw ${policy.minOutRaw} (router slippage ${policy.routerSlippageUnits} on the 1e6 scale), deadline ${new Date(policy.deadlineMsEpoch).toISOString()}, quoteAgeMs ${policy.quoteAgeMs}. The router enforces the minimum output on chain at settle; these values are review evidence only and are not transaction bytes, signing data, or signing readiness.`,
        "quote"
      )
    ]
  };
}

function flowxQuotePolicyAmount(
  raw: string,
  asset: FlowxCoinMeta
): {
  raw: string;
  asset: { symbol: string; coinType: string; decimals: number; unitSource: typeof FLOWX_CLMM_UNIT_SOURCE };
} {
  return {
    raw,
    asset: {
      symbol: asset.symbol,
      coinType: asset.coinType,
      decimals: asset.decimals,
      unitSource: FLOWX_CLMM_UNIT_SOURCE
    }
  };
}

function quoteSourceFailureOutcome(error: unknown): FlowxStageOutcome<never> {
  const checks: NonEmptyReviewChecks = [
    failReviewCheck(
      "flowx_quote_source_failed",
      "Quote source",
      error instanceof Error ? error.message : "FlowX quote source failed.",
      "quote"
    )
  ];
  if (error instanceof ReadServiceInputError) {
    if (error.kind === "input_invalid") {
      return { status: "blocked", blockedReason: "amount_mismatch", checks };
    }
    if (error.kind === "registry_miss") {
      return { status: "blocked", blockedReason: "asset_mismatch", checks };
    }
    if (error.kind === "quote_unavailable") {
      return { status: "refresh_required", refreshReason: "quote_unavailable", checks };
    }
  }
  return { status: "blocked", blockedReason: "object_resolution_failed", checks };
}

function missingProducerStageCheck(adapterLifecycle: FlowxSwapReviewLifecycle): ReviewCheck {
  const nextMissing = adapterLifecycle.missingStages[0];
  if (nextMissing === undefined) {
    return contractEmitMissingCheck();
  }
  const nextMissingLabel = flowxSwapReviewLifecycleStageLabel(nextMissing);
  return {
    id: `flowx_${nextMissing}_missing`,
    label: nextMissingLabel,
    status: "fail",
    message: `FlowX account-bound review has not completed ${nextMissingLabel}. This is required before wallet handoff, signing, or execution, and no transaction bytes or signing readiness are available.`,
    source: "adapter"
  };
}

function missingProducerStageBlockedResult(
  adapterLifecycle: FlowxSwapReviewLifecycle,
  checks: ReviewCheck[],
  fields: FlowxReviewPublicEvidenceFields = {}
): ReviewComputationResult {
  const nextMissing = adapterLifecycle.missingStages[0];
  if (nextMissing === undefined) {
    if (!fields.humanReadableReview || !fields.simulation) {
      throw new Error(
        "wallet_review_contract_emit_missing requires human-readable review and simulation public evidence"
      );
    }
    return walletReviewContractEmitMissingResult(
      [...checks, contractEmitMissingCheck()],
      adapterLifecycle,
      fields.humanReadableReview,
      fields.simulation
    );
  }
  return producerStageMissingReviewResult(
    [...checks, missingProducerStageCheck(adapterLifecycle)],
    adapterLifecycle,
    fields.humanReadableReview ? { humanReadableReview: fields.humanReadableReview } : {}
  );
}

function contractEmitMissingCheck(): ReviewCheck {
  return {
    id: "flowx_wallet_review_contract_emit_missing",
    label: "Wallet review contract emit",
    status: "fail",
    message:
      "FlowX account-bound review completed review-time simulation, but this review did not assemble a wallet review contract, so signing stays blocked for this session.",
    source: "adapter"
  };
}
