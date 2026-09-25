import type {
  AssetFlow,
  AdapterLifecycle,
  BalanceChange,
  BlockedReason,
  HumanReadableReviewSummary,
  ReviewCheck,
  RefreshReason,
  ReviewState,
  SuccessfulTransactionSimulationSummary,
  TransactionSimulationSummary
} from "../action/types.js";
import type { AdapterLifecycleValidator } from "../action/adapterLifecycleValidation.js";
import { parseLifecycleValidatedReviewState } from "../action/reviewStateValidation.js";
import type { PtbVisualizationArtifact, TransactionReviewData } from "../action/signableAdapterContract.js";

export type ReviewComputationResultBase = {
  checks: ReviewCheck[];
  assetFlowActual?: AssetFlow;
  beforeAfterBalance?: BalanceChange;
  simulation?: TransactionSimulationSummary;
  humanReadableReview?: HumanReadableReviewSummary;
  transactionReviewData?: TransactionReviewData;
  ptbVisualization?: PtbVisualizationArtifact;
  adapterLifecycle?: AdapterLifecycle;
  updatedAt?: string;
};

export type ReviewComputationResult =
  | (ReviewComputationResultBase & {
      status: "ready_for_wallet_review";
      blockedReason?: never;
      refreshReason?: never;
    })
  | (ReviewComputationResultBase & {
      status: "refresh_required";
      refreshReason: RefreshReason;
      blockedReason?: never;
    })
  | (ReviewComputationResultBase & {
      status: "blocked";
      blockedReason: BlockedReason;
      refreshReason?: never;
    });

export type ReviewStateIdentity = {
  planId: string;
  reviewSessionId: string;
  account: string;
  now?: Date | undefined;
};

export function mapReviewComputationResultToState(
  identity: ReviewStateIdentity,
  result: ReviewComputationResult,
  validateAdapterLifecycle: AdapterLifecycleValidator
): ReviewState {
  const base = {
    planId: identity.planId,
    reviewSessionId: identity.reviewSessionId,
    account: identity.account,
    checks: result.checks,
    updatedAt: result.updatedAt ?? (identity.now ?? new Date()).toISOString(),
    ...(result.assetFlowActual ? { assetFlowActual: result.assetFlowActual } : {}),
    ...(result.beforeAfterBalance ? { beforeAfterBalance: result.beforeAfterBalance } : {}),
    ...(result.simulation ? { simulation: result.simulation } : {}),
    ...(result.humanReadableReview ? { humanReadableReview: result.humanReadableReview } : {}),
    ...(result.transactionReviewData
      ? { transactionReviewData: result.transactionReviewData }
      : {}),
    ...(result.ptbVisualization ? { ptbVisualization: result.ptbVisualization } : {}),
    ...(result.adapterLifecycle ? { adapterLifecycle: result.adapterLifecycle } : {})
  };

  if (result.status === "ready_for_wallet_review") {
    return parseMappedReviewState({
      ...base,
      status: "ready_for_wallet_review"
    }, validateAdapterLifecycle);
  }

  if (result.status === "refresh_required") {
    return parseMappedReviewState({
      ...base,
      status: "refresh_required",
      refreshReason: result.refreshReason
    }, validateAdapterLifecycle);
  }

  return parseMappedReviewState({
    ...base,
    status: "blocked",
    blockedReason: result.blockedReason
  }, validateAdapterLifecycle);
}

function parseMappedReviewState(
  state: ReviewState,
  validateAdapterLifecycle: AdapterLifecycleValidator
): ReviewState {
  return parseLifecycleValidatedReviewState(state, validateAdapterLifecycle);
}

export function blockedReviewResult(
  blockedReason: BlockedReason,
  checks: ReviewCheck[],
  fields: Pick<ReviewComputationResultBase, "adapterLifecycle" | "humanReadableReview" | "simulation"> = {}
): ReviewComputationResult {
  return {
    status: "blocked",
    blockedReason,
    checks,
    ...fields
  };
}

export function blockedAdapterLifecycleReviewResult(
  blockedReason: BlockedReason,
  checks: ReviewCheck[],
  adapterLifecycle: AdapterLifecycle
): ReviewComputationResult {
  return blockedReviewResult(blockedReason, checks, { adapterLifecycle });
}

export function producerStageMissingReviewResult(
  checks: ReviewCheck[],
  adapterLifecycle: AdapterLifecycle,
  fields: Pick<ReviewComputationResultBase, "humanReadableReview"> = {}
): ReviewComputationResult {
  return blockedReviewResult("producer_stage_missing", checks, {
    adapterLifecycle,
    ...fields
  });
}

export function walletReviewContractEmitMissingResult(
  checks: ReviewCheck[],
  adapterLifecycle: AdapterLifecycle,
  humanReadableReview: HumanReadableReviewSummary,
  simulation: SuccessfulTransactionSimulationSummary
): ReviewComputationResult {
  return blockedReviewResult("wallet_review_contract_emit_missing", checks, {
    adapterLifecycle,
    humanReadableReview,
    simulation
  });
}

export function walletReviewContractEmittedResult(
  checks: ReviewCheck[],
  adapterLifecycle: AdapterLifecycle,
  humanReadableReview: HumanReadableReviewSummary,
  simulation: SuccessfulTransactionSimulationSummary,
  transactionReviewData: TransactionReviewData,
  ptbVisualization?: PtbVisualizationArtifact
): ReviewComputationResult {
  return {
    status: "ready_for_wallet_review",
    checks,
    adapterLifecycle,
    humanReadableReview,
    simulation,
    transactionReviewData,
    ...(ptbVisualization ? { ptbVisualization } : {})
  };
}

export function refreshRequiredReviewResult(
  refreshReason: RefreshReason,
  checks: ReviewCheck[],
  fields: Pick<ReviewComputationResultBase, "adapterLifecycle" | "humanReadableReview" | "simulation"> = {}
): ReviewComputationResult {
  return {
    status: "refresh_required",
    refreshReason,
    checks,
    ...fields
  };
}

export function refreshRequiredAdapterLifecycleReviewResult(
  refreshReason: RefreshReason,
  checks: ReviewCheck[],
  adapterLifecycle: AdapterLifecycle
): ReviewComputationResult {
  return refreshRequiredReviewResult(refreshReason, checks, { adapterLifecycle });
}

export { failReviewCheck, passReviewCheck } from "../action/reviewCheckResults.js";
