import type { UserAnswerUse } from "../evidence/userAnswerUse.js";
import type { ProposalReviewModel } from "../proposal/types.js";
import type { LocalSessionBase } from "../session/localSession.js";
import type { PtbVisualizationArtifact, WalletReviewAdapterContract } from "./signableAdapterContract.js";
import type { SuiChainReceiptEvidence } from "./suiChainReceiptEvidence.js";
export {
  SUI_CHAIN_RECEIPT_REQUIRED_INCLUDE,
  type SuiChainReceiptAccountBalanceChange,
  type SuiChainReceiptEffectsStatus,
  type SuiChainReceiptEvidence,
  type SuiChainReceiptIncludeField,
  type SuiChainReceiptPackageCall,
  type SuiChainReceiptSource
} from "./suiChainReceiptEvidence.js";

export type UnknownRecord = Record<string, unknown>;

export const FAILURE_REASONS = [
  "wallet_rejected",
  "wallet_provider_error",
  "signing_disconnected",
  "network_error",
  "transaction_submit_failed",
  "execution_result_unavailable",
  "chain_receipt_unavailable",
  "receipt_verification_failed",
  "chain_execution_failed",
  "unknown_failure"
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

export const BLOCKED_REASONS = [
  "adapter_not_implemented",
  "producer_stage_missing",
  "wallet_review_contract_emit_missing",
  "wallet_handoff_not_implemented",
  "network_mismatch",
  "insufficient_balance",
  "insufficient_gas",
  "allowlist_violation",
  "asset_mismatch",
  "amount_mismatch",
  "wallet_mismatch",
  "unsupported_action",
  "object_resolution_failed",
  "proposal_review_only"
] as const;

export type BlockedReason = (typeof BLOCKED_REASONS)[number];

export const REFRESH_REASONS = [
  "quote_stale",
  "quote_unavailable",
  "simulation_transient_failure"
] as const;

export type RefreshReason = (typeof REFRESH_REASONS)[number];

export type ReviewStatus =
  | "ready_for_wallet_review"
  | "refresh_required"
  | "blocked";

export type InternalSessionStatus =
  | "proposed"
  | "awaiting_wallet"
  | "wallet_connected"
  | ReviewStatus
  | "signed_pending_result"
  | "success"
  | "failure"
  | "expired";

export type ExecutionStatus =
  | "pending"
  | "awaiting_wallet"
  | "awaiting_signature"
  | "refresh_required"
  | "signed_pending_result"
  | "success"
  | "failure"
  | "expired";

export type ReviewCheckSource =
  | "registry"
  | "quote"
  | "wallet"
  | "simulation"
  | "adapter"
  | "network"
  | "proposal";

export type ReviewCheck = {
  id: string;
  label: string;
  status: "pass" | "warning" | "fail";
  message: string;
  source: ReviewCheckSource;
};

export type AdapterLifecycle = {
  stageCatalogId: string;
  adapterId: string;
  protocol: string;
  actionKind: string;
  completedStages: string[];
  missingStages: string[];
};

export type AssetAmount = {
  symbol: string;
  amount: string;
  coinType?: string;
  approx?: boolean;
};

export type DisplayIntentAssetAmount = AssetAmount & {
  amountKind: "display_intent";
};

export type AssetFlowPreview = {
  outgoing: DisplayIntentAssetAmount[];
  expectedIncoming: DisplayIntentAssetAmount[];
  minimumIncoming?: DisplayIntentAssetAmount[];
  fees?: DisplayIntentAssetAmount[];
};

export type AssetFlow = {
  outgoing: AssetAmount[];
  expectedIncoming: AssetAmount[];
  minimumIncoming?: AssetAmount[];
  fees?: AssetAmount[];
};

export type BalanceChange = {
  before: AssetAmount[];
  after: AssetAmount[];
  delta: AssetAmount[];
};

export type TransactionSimulationGasCostSummary = {
  computationCostRaw: string;
  storageCostRaw: string;
  storageRebateRaw: string;
  nonRefundableStorageFeeRaw: string;
};

export type TransactionSimulationBalanceChange = {
  address: string;
  coinType: string;
  amount: string;
};

export type TransactionSimulationObjectChange = {
  objectId: string;
  objectType?: string | undefined;
  inputState: string;
  outputState: string;
  idOperation: string;
};

export type TransactionSimulationSummary = {
  provider: "client.core.simulateTransaction";
  checksEnabled: boolean;
  success: boolean;
  gasCostSummary?: TransactionSimulationGasCostSummary;
  balanceChanges?: TransactionSimulationBalanceChange[];
  objectChanges?: TransactionSimulationObjectChange[];
  error?: string;
};

export type SuccessfulTransactionSimulationSummary = TransactionSimulationSummary & {
  checksEnabled: true;
  success: true;
  gasCostSummary: TransactionSimulationGasCostSummary;
  balanceChanges: TransactionSimulationBalanceChange[];
  objectChanges: TransactionSimulationObjectChange[];
  error?: never;
};

export type SwapHumanReadableReviewAmount = {
  role: "input" | "expected_output" | "minimum_output" | "fee";
  symbol: string;
  coinType: string;
  decimals: number;
  rawAmount: string;
  rawAmountSource: "quote_policy_evidence";
  displayAmount?: string | undefined;
  displayAmountSource?: "user_display_intent_not_signing_input" | undefined;
};

export type HumanReadableReviewParty = {
  role: "connected_account" | "output_recipient";
  address: string;
};

export type SwapHumanReadableReviewTarget = {
  kind: "swap_output_asset";
  symbol: string;
  coinType: string;
  protocol: string;
  poolKey: string;
  direction: "base_to_quote" | "quote_to_base";
};

export type HumanReadableReviewFact = {
  id: string;
  label: string;
  source: ReviewCheckSource | "transaction_material" | "digest_commitment";
  summary: string;
};

export type HumanReadableReviewGap = {
  id: string;
  label: string;
  reason: string;
};

export type HumanReadableReviewEnvelope = {
  proposedAction: {
    title: string;
    summary: string;
    actionKind: string;
    adapterId: string;
    protocol: string;
    network: "sui:mainnet";
  };
  recipients: HumanReadableReviewParty[];
  evidenceUsed: HumanReadableReviewFact[];
  missingEvidence: HumanReadableReviewGap[];
  requiredUserChoices: HumanReadableReviewGap[];
  unsupportedClaims: HumanReadableReviewGap[];
  freshness: {
    status: "current";
    evaluatedAt: string;
    expiresAt: string;
    reason: string;
  };
  blockingChecks: ReviewCheck[];
};

export type HumanReadableReviewSummaryBase<TKind extends string> =
  HumanReadableReviewEnvelope & {
    kind: TKind;
  };

export type SwapHumanReadableReviewProjection = {
  assetFlow: {
    outgoing: SwapHumanReadableReviewAmount[];
    expectedIncoming: SwapHumanReadableReviewAmount[];
    minimumIncoming: SwapHumanReadableReviewAmount[];
    fees: SwapHumanReadableReviewAmount[];
  };
  targets: SwapHumanReadableReviewTarget[];
};

export type SwapHumanReadableReviewSummary =
  HumanReadableReviewSummaryBase<"swap_human_readable_review"> &
  SwapHumanReadableReviewProjection;

export type HumanReadableReviewSummary = SwapHumanReadableReviewSummary;

export type ActionPlan<TAdapterData extends UnknownRecord = UnknownRecord> = {
  id: string;
  actionKind: string;
  adapterId: string;
  protocol: string;
  title: string;
  summary: string;
  assetFlowPreview: AssetFlowPreview;
  reviewModel?: ProposalReviewModel;
  adapterData: TAdapterData;
  createdAt: string;
  expiresAt?: string;
  registryVersion?: string;
  preliminaryChecks?: ReviewCheck[];
};

type ReviewStateBase = {
  planId: string;
  reviewSessionId: string;
  account: string;
  checks: ReviewCheck[];
  assetFlowActual?: AssetFlow;
  beforeAfterBalance?: BalanceChange;
  simulation?: TransactionSimulationSummary;
  humanReadableReview?: HumanReadableReviewSummary;
  walletReviewAdapterContract?: WalletReviewAdapterContract;
  ptbVisualization?: PtbVisualizationArtifact;
  adapterLifecycle?: AdapterLifecycle;
  updatedAt: string;
};

export type ReviewState =
  | (ReviewStateBase & {
      status: "ready_for_wallet_review";
      blockedReason?: never;
      refreshReason?: never;
    })
  | (ReviewStateBase & {
      status: "refresh_required";
      refreshReason: RefreshReason;
      blockedReason?: never;
    })
  | (ReviewStateBase & {
      status: "blocked";
      blockedReason: BlockedReason;
      refreshReason?: never;
    });

type ExecutionResultBase = {
  reviewSessionId: string;
  planId: string;
  explorerUrl?: string;
  summary?: UnknownRecord;
  recordedAt: string;
};

export type ExecutionResult =
  | (ExecutionResultBase & {
      status: "signed_pending_result";
      txDigest: string;
      failureReason?: never;
      chainReceipt?: never;
    })
  | (ExecutionResultBase & {
      status: "success";
      txDigest: string;
      chainReceipt: SuiChainReceiptEvidence;
      failureReason?: never;
    })
  | (ExecutionResultBase & {
      status: "failure";
      txDigest?: string;
      failureReason: FailureReason;
      chainReceipt?: SuiChainReceiptEvidence;
    });

export type ReviewSession = LocalSessionBase & {
  pendingHandoffDigest?: string;
  status: InternalSessionStatus;
  plans: ActionPlan[];
  account?: string;
  reviewState?: ReviewState;
  executionResult?: ExecutionResult;
};

export type ToolErrorKind =
  | "ui_unavailable"
  | "input_invalid"
  | "registry_miss"
  | "unsupported_action"
  | "network_mismatch"
  | "quote_unavailable"
  | "blocked"
  | "session_not_found"
  | "active_account_not_set"
  | "session_expired"
  | "invalid_session_transition"
  | "execution_result_finalized"
  | "signed_pending_result_conflict"
  | "plan_not_in_session"
  | "session_mismatch"
  | "handoff_unavailable"
  | "handoff_commitment_mismatch"
  | "request_aborted"
  | "metadata_cache_unavailable"
  | "internal_error";

export type ToolError = {
  kind: ToolErrorKind;
  details: UnknownRecord;
};

export type McpActionResponse = {
  reviewSessionId: string;
  reviewUrl: string;
  plans: ActionPlan[];
  preliminaryChecks: ReviewCheck[];
  userAnswerUse: UserAnswerUse;
};

export type McpToolPayload<T extends UnknownRecord = UnknownRecord> = {
  ok: true;
  data: T;
};

export type McpToolErrorPayload = {
  ok: false;
  error: ToolError;
};

export type McpToolResponse<T extends UnknownRecord = UnknownRecord> =
  | McpToolPayload<T>
  | McpToolErrorPayload;

export const REVIEW_UI_LABELS: Record<ReviewStatus, string> = {
  ready_for_wallet_review: "Ready for wallet review",
  refresh_required: "Refresh required",
  blocked: "Blocked"
};
